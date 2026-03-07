// routes/payment.js — PhonePe Payment Gateway
const express  = require('express');
const crypto   = require('crypto');
const axios    = require('axios');
const Order    = require('../models/Order');
const shiprocket = require('../config/shiprocket');

const router = express.Router();

const MERCHANT_ID = process.env.PHONEPE_MERCHANT_ID;
const SALT_KEY    = process.env.PHONEPE_SALT_KEY;
const SALT_INDEX  = process.env.PHONEPE_SALT_INDEX || '1';
const IS_PROD     = process.env.NODE_ENV === 'production';

const PAY_URL    = IS_PROD
  ? 'https://api.phonepe.com/apis/hermes/pg/v1/pay'
  : 'https://api-preprod.phonepe.com/apis/pg-sandbox/pg/v1/pay';

const STATUS_URL = IS_PROD
  ? 'https://api.phonepe.com/apis/hermes/pg/v1/status'
  : 'https://api-preprod.phonepe.com/apis/pg-sandbox/pg/v1/status';

// PhonePe checksum for payment initiation
function makePayChecksum(payloadBase64) {
  const hash = crypto.createHash('sha256')
    .update(payloadBase64 + '/pg/v1/pay' + SALT_KEY)
    .digest('hex');
  return `${hash}###${SALT_INDEX}`;
}

// PhonePe checksum for status check
function makeStatusChecksum(txnId) {
  const endpoint = `/pg/v1/status/${MERCHANT_ID}/${txnId}`;
  const hash = crypto.createHash('sha256')
    .update(endpoint + SALT_KEY)
    .digest('hex');
  return `${hash}###${SALT_INDEX}`;
}

// ── POST /api/payment/initiate ────────────────────────────────────────
router.post('/initiate', async (req, res) => {
  try {
    const { cartItems, customer, subtotal, shippingCharge, discount, total, couponCode } = req.body;

    if (!total || total < 1)  return res.status(400).json({ error: 'Invalid amount' });
    if (!customer?.email)     return res.status(400).json({ error: 'Customer details required' });
    if (!cartItems?.length)   return res.status(400).json({ error: 'Cart is empty' });

    // Save order
    const order = new Order({
      customer, items: cartItems, subtotal,
      shippingCharge: shippingCharge || 0,
      discount: discount || 0, total, couponCode,
      paymentMethod: 'prepaid',
      paymentStatus: 'pending',
      orderStatus:   'pending'
    });
    await order.save();

    // Transaction ID — alphanumeric only, max 38 chars
    const txnId = `VRK${Date.now()}`.slice(0, 38);
    order.phonepeTransactionId = txnId;
    await order.save();

    // PhonePe payload
    const payload = {
      merchantId:            MERCHANT_ID,
      merchantTransactionId: txnId,
      merchantUserId:        `MUID${customer.phone}`,
      name:                  `${customer.firstName} ${customer.lastName}`,
      amount:                Math.round(total * 100),
      redirectUrl:           `${process.env.BACKEND_URL}/api/payment/callback`,
      redirectMode:          'POST',
      mobileNumber:          String(customer.phone),
      paymentInstrument:     { type: 'PAY_PAGE' }
    };

    const payloadBase64 = Buffer.from(JSON.stringify(payload)).toString('base64');
    const checksum      = makePayChecksum(payloadBase64);

    const response = await axios.post(
      PAY_URL,
      { request: payloadBase64 },
      { headers: { 'Content-Type': 'application/json', 'X-VERIFY': checksum } }
    );

    const redirectUrl = response.data?.data?.instrumentResponse?.redirectInfo?.url;
    if (!redirectUrl) throw new Error('No redirect URL from PhonePe');

    res.json({ success: true, redirectUrl, orderId: order.orderId, txnId });

  } catch (err) {
    console.error('PhonePe initiate error:', err?.response?.data || err.message);
    res.status(500).json({ error: 'Payment initiation failed. Please try again.' });
  }
});

// ── POST /api/payment/callback ────────────────────────────────────────
// PhonePe redirects customer here after payment
router.post('/callback', async (req, res) => {
  try {
    // Decode PhonePe response
    const { response: encodedResponse } = req.body;
    let txnId;

    if (encodedResponse) {
      const decoded = JSON.parse(Buffer.from(encodedResponse, 'base64').toString('utf8'));
      txnId = decoded?.data?.merchantTransactionId;
    }

    if (!txnId) return res.redirect(`${process.env.FRONTEND_URL}/payment-failed.html`);

    // Verify with PhonePe status API
    const checksum  = makeStatusChecksum(txnId);
    const statusRes = await axios.get(
      `${STATUS_URL}/${MERCHANT_ID}/${txnId}`,
      {
        headers: {
          'Content-Type':  'application/json',
          'X-VERIFY':      checksum,
          'X-MERCHANT-ID': MERCHANT_ID
        }
      }
    );

    const data      = statusRes.data;
    const isSuccess = data?.success === true || data?.code === 'PAYMENT_SUCCESS';

    const order = await Order.findOne({ phonepeTransactionId: txnId });
    if (!order) return res.redirect(`${process.env.FRONTEND_URL}/payment-failed.html`);

    if (isSuccess) {
      order.paymentStatus    = 'completed';
      order.orderStatus      = 'confirmed';
      order.phonepePaymentId = data?.data?.transactionId || txnId;
      await order.save();

      // Push to Shiprocket
      shiprocket.createOrder(order)
        .then(async sr => {
          order.shiprocket = {
            orderId:    sr.order_id,
            shipmentId: sr.shipment_id,
            status:     sr.status
          };
          order.orderStatus = 'processing';
          await order.save();
        }).catch(e => console.error('Shiprocket error:', e.message));

      return res.redirect(`${process.env.FRONTEND_URL}/order-confirmed.html?order=${order.orderId}`);

    } else {
      order.paymentStatus = 'failed';
      await order.save();
      return res.redirect(`${process.env.FRONTEND_URL}/payment-failed.html?order=${order.orderId}`);
    }

  } catch (err) {
    console.error('Callback error:', err?.response?.data || err.message);
    res.redirect(`${process.env.FRONTEND_URL}/payment-failed.html`);
  }
});

// ── GET /api/payment/status/:txnId ────────────────────────────────────
router.get('/status/:txnId', async (req, res) => {
  try {
    const { txnId } = req.params;
    const checksum  = makeStatusChecksum(txnId);
    const response  = await axios.get(
      `${STATUS_URL}/${MERCHANT_ID}/${txnId}`,
      {
        headers: {
          'Content-Type':  'application/json',
          'X-VERIFY':      checksum,
          'X-MERCHANT-ID': MERCHANT_ID
        }
      }
    );
    res.json(response.data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/payment/cod-order ───────────────────────────────────────
router.post('/cod-order', async (req, res) => {
  try {
    const { cartItems, customer, subtotal, shippingCharge, discount, total, couponCode } = req.body;
    if (!customer?.email) return res.status(400).json({ error: 'Customer details required' });

    const order = new Order({
      customer, items: cartItems, subtotal,
      shippingCharge: shippingCharge || 0,
      discount: discount || 0, total, couponCode,
      paymentMethod: 'cod',
      paymentStatus: 'pending',
      orderStatus:   'confirmed'
    });
    await order.save();

    shiprocket.createOrder(order)
      .then(async sr => {
        order.shiprocket = { orderId: sr.order_id, shipmentId: sr.shipment_id };
        order.orderStatus = 'processing';
        await order.save();
      }).catch(e => console.error('Shiprocket COD error:', e.message));

    res.json({ success: true, orderId: order.orderId });

  } catch (err) {
    console.error('COD error:', err);
    res.status(500).json({ error: 'Could not place order. Please try again.' });
  }
});

// ── GET /api/payment/check-serviceability ─────────────────────────────
router.get('/check-serviceability', async (req, res) => {
  try {
    const { pincode, weight = 0.3, cod = false } = req.query;
    const pickupPin = process.env.PICKUP_PINCODE || '422001';
    const data = await shiprocket.checkServiceability(pickupPin, pincode, weight, cod);
    const couriers = data?.data?.available_courier_companies || [];
    const cheapest = couriers.sort((a, b) => a.rate - b.rate)[0];
    res.json({
      serviceable:   couriers.length > 0,
      cheapestRate:  cheapest?.rate || 0,
      estimatedDays: cheapest?.estimated_delivery_days || 'N/A'
    });
  } catch {
    res.json({ serviceable: true, cheapestRate: 60 });
  }
});

module.exports = router;
