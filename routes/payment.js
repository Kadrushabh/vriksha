// routes/payment.js  —  Razorpay integration
const express  = require('express');
const Razorpay = require('razorpay');
const crypto   = require('crypto');
const Order    = require('../models/Order');
const shiprocket = require('../config/shiprocket');
const { sendOrderConfirmation } = require('../config/mailer');

const router = express.Router();

const razorpay = new Razorpay({
  key_id:     process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET
});

// ── POST /api/payment/create-order ────────────────────────────────────
// Called by frontend when customer clicks "Pay Now"
router.post('/create-order', async (req, res) => {
  try {
    const { amount, currency = 'INR', cartItems, customer, couponCode } = req.body;

    // Basic validation
    if (!amount || amount < 1) return res.status(400).json({ error: 'Invalid amount' });
    if (!customer?.email || !customer?.phone) return res.status(400).json({ error: 'Customer details required' });

    // Create Razorpay order
    const rzpOrder = await razorpay.orders.create({
      amount:   Math.round(amount * 100),  // paise
      currency,
      receipt:  `VRK_${Date.now()}`,
      notes:    { email: customer.email, phone: customer.phone }
    });

    // Pre-create order in DB with pending status
    const order = new Order({
      customer,
      items:          cartItems,
      subtotal:       req.body.subtotal,
      shippingCharge: req.body.shippingCharge || 0,
      discount:       req.body.discount       || 0,
      total:          amount,
      couponCode,
      paymentMethod:  'prepaid',
      paymentStatus:  'pending',
      razorpayOrderId: rzpOrder.id
    });
    await order.save();

    res.json({
      success:        true,
      razorpay_order_id: rzpOrder.id,
      amount:         rzpOrder.amount,
      currency:       rzpOrder.currency,
      internal_order_id: order.orderId,
      key_id:         process.env.RAZORPAY_KEY_ID
    });

  } catch (err) {
    console.error('Create order error:', err);
    res.status(500).json({ error: 'Could not create order. Please try again.' });
  }
});

// ── POST /api/payment/verify ──────────────────────────────────────────
// Called by frontend after Razorpay payment completes
router.post('/verify', async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

    // 1. Verify Razorpay signature — CRITICAL security step
    const expectedSig = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest('hex');

    if (expectedSig !== razorpay_signature) {
      return res.status(400).json({ success: false, error: 'Payment verification failed' });
    }

    // 2. Find & update order
    const order = await Order.findOne({ razorpayOrderId: razorpay_order_id });
    if (!order) return res.status(404).json({ error: 'Order not found' });

    order.paymentStatus    = 'completed';
    order.orderStatus      = 'confirmed';
    order.razorpayPaymentId = razorpay_payment_id;
    await order.save();

    // 3. Create Shiprocket order (async — don't block response)
    shiprocket.createOrder(order).then(async (srRes) => {
      order.shiprocket = {
        orderId:    srRes.order_id,
        shipmentId: srRes.shipment_id,
        status:     srRes.status
      };
      order.orderStatus = 'processing';
      await order.save();
    }).catch(err => console.error('Shiprocket create failed:', err.message));

    // 4. Send confirmation email (async)
    sendOrderConfirmation(order);

    res.json({
      success:  true,
      orderId:  order.orderId,
      message:  'Payment confirmed! Your order is being prepared.'
    });

  } catch (err) {
    console.error('Verify error:', err);
    res.status(500).json({ error: 'Verification failed. Contact support.' });
  }
});

// ── POST /api/payment/cod-order ───────────────────────────────────────
// Cash on Delivery — no payment step
router.post('/cod-order', async (req, res) => {
  try {
    const { cartItems, customer, subtotal, shippingCharge, discount, total, couponCode } = req.body;

    if (!customer?.email) return res.status(400).json({ error: 'Customer details required' });

    const order = new Order({
      customer, items: cartItems,
      subtotal, shippingCharge: shippingCharge || 0,
      discount: discount || 0, total,
      couponCode,
      paymentMethod: 'cod',
      paymentStatus: 'pending',  // COD — paid on delivery
      orderStatus:   'confirmed'
    });
    await order.save();

    // Create in Shiprocket
    shiprocket.createOrder(order).then(async (srRes) => {
      order.shiprocket = { orderId: srRes.order_id, shipmentId: srRes.shipment_id };
      order.orderStatus = 'processing';
      await order.save();
    }).catch(err => console.error('Shiprocket COD failed:', err.message));

    sendOrderConfirmation(order);

    res.json({ success: true, orderId: order.orderId });

  } catch (err) {
    console.error('COD order error:', err);
    res.status(500).json({ error: 'Could not place order. Please try again.' });
  }
});

// ── GET /api/payment/check-serviceability ────────────────────────────
router.get('/check-serviceability', async (req, res) => {
  try {
    const { pincode, weight = 0.3, cod = false } = req.query;
    const YOUR_PICKUP_PINCODE = '110001'; // ← Replace with your pickup/warehouse pincode

    const data = await shiprocket.checkServiceability(YOUR_PICKUP_PINCODE, pincode, weight, cod);

    // Return simplified list of available couriers + cheapest rate
    const couriers = data?.data?.available_courier_companies || [];
    const cheapest = couriers.sort((a, b) => a.rate - b.rate)[0];

    res.json({
      serviceable: couriers.length > 0,
      couriers:    couriers.length,
      cheapestRate: cheapest?.rate || 0,
      estimatedDays: cheapest?.estimated_delivery_days || 'N/A'
    });
  } catch (err) {
    res.json({ serviceable: true, cheapestRate: 60 }); // fallback
  }
});

module.exports = router;
