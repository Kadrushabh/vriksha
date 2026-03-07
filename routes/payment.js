// routes/payment.js — Razorpay Payment Gateway
const express    = require('express');
const crypto     = require('crypto');
const Razorpay   = require('razorpay');
const Order      = require('../models/Order');
const shiprocket = require('../config/shiprocket');

const router = express.Router();

const razorpay = new Razorpay({
  key_id:     process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET
});

// ── POST /api/payment/initiate ────────────────────────────────────────
router.post('/initiate', async (req, res) => {
  try {
    const { cartItems, customer, subtotal, shippingCharge, discount, total } = req.body;

    if (!total || total < 1)  return res.status(400).json({ error: 'Invalid amount' });
    if (!customer?.email)     return res.status(400).json({ error: 'Customer details required' });
    if (!cartItems?.length)   return res.status(400).json({ error: 'Cart is empty' });

    // Create Razorpay order
    const razorpayOrder = await razorpay.orders.create({
      amount:   Math.round(total * 100), // paise
      currency: 'INR',
      receipt:  `VRK${Date.now()}`.slice(0, 40),
      notes: {
        customer_email: customer.email,
        customer_phone: customer.phone
      }
    });

    // Save order to DB
    const order = new Order({
      customer,
      items: cartItems.map(i => ({
        productId:  i.id || i.productId || 'unknown',
        name:       i.name,
        price:      Number(i.price),
        quantity:   Number(i.quantity),
        totalPrice: Number(i.price) * Number(i.quantity)
      })),
      subtotal,
      shippingCharge: shippingCharge || 0,
      discount:       discount || 0,
      total,
      paymentMethod:  'prepaid',
      paymentStatus:  'pending',
      orderStatus:    'pending',
      razorpayOrderId: razorpayOrder.id
    });
    await order.save();

    res.json({
      success:        true,
      razorpayOrderId: razorpayOrder.id,
      amount:         razorpayOrder.amount,
      currency:       razorpayOrder.currency,
      orderId:        order.orderId,
      customerName:   `${customer.firstName} ${customer.lastName}`,
      customerEmail:  customer.email,
      customerPhone:  customer.phone
    });

  } catch (err) {
    const errDetail = err?.error || err?.response?.data || err?.message || err;
    console.error('Razorpay initiate error FULL:', JSON.stringify(errDetail));
    console.error('Razorpay status code:', err?.statusCode);
    res.status(500).json({ 
      error: 'Payment initiation failed. Please try again.',
      debug: errDetail  // temporary - remove after fixing
    });
  }
});

// ── POST /api/payment/verify ──────────────────────────────────────────
router.post('/verify', async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, orderId } = req.body;

    // Verify signature
    const body     = razorpay_order_id + '|' + razorpay_payment_id;
    const expected = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(body)
      .digest('hex');

    if (expected !== razorpay_signature) {
      return res.status(400).json({ success: false, error: 'Invalid payment signature' });
    }

    // Update order
    const order = await Order.findOne({ razorpayOrderId: razorpay_order_id });
    if (!order) return res.status(404).json({ success: false, error: 'Order not found' });

    order.paymentStatus    = 'completed';
    order.orderStatus      = 'confirmed';
    order.razorpayPaymentId = razorpay_payment_id;
    await order.save();

    // Push to Shiprocket
    shiprocket.createOrder(order)
      .then(async sr => {
        order.shiprocket  = { orderId: sr.order_id, shipmentId: sr.shipment_id };
        order.orderStatus = 'processing';
        await order.save();
      }).catch(e => console.error('Shiprocket error:', e.message));

    res.json({ success: true, orderId: order.orderId });

  } catch (err) {
    console.error('Verify error:', err.message);
    res.status(500).json({ success: false, error: 'Verification failed' });
  }
});

// ── POST /api/payment/cod-order ───────────────────────────────────────
router.post('/cod-order', async (req, res) => {
  try {
    const { cartItems, customer, subtotal, shippingCharge, discount, total } = req.body;
    if (!customer?.email) return res.status(400).json({ error: 'Customer details required' });

    const order = new Order({
      customer,
      items: cartItems.map(i => ({
        productId:  i.id || i.productId || 'unknown',
        name:       i.name,
        price:      Number(i.price),
        quantity:   Number(i.quantity),
        totalPrice: Number(i.price) * Number(i.quantity)
      })),
      subtotal,
      shippingCharge: shippingCharge || 0,
      discount:       discount || 0,
      total,
      paymentMethod:  'cod',
      paymentStatus:  'pending',
      orderStatus:    'confirmed'
    });
    await order.save();

    shiprocket.createOrder(order)
      .then(async sr => {
        order.shiprocket  = { orderId: sr.order_id, shipmentId: sr.shipment_id };
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
    const data      = await shiprocket.checkServiceability(pickupPin, pincode, weight, cod);
    const couriers  = data?.data?.available_courier_companies || [];
    const cheapest  = couriers.sort((a, b) => a.rate - b.rate)[0];
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
