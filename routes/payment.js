// routes/payment.js — Razorpay Payment Gateway
const express    = require('express');
const crypto     = require('crypto');
const Razorpay   = require('razorpay');
const Order      = require('../models/Order');
const shiprocket = require('../config/shiprocket');
const { sendOrderConfirmation } = require('../config/mailer');

const router = express.Router();

const razorpay = new Razorpay({
  key_id:     process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET
});


// ── POST /api/payment/initiate ────────────────────────────────────────
router.post('/initiate', async (req, res) => {
  try {
    const { cartItems, customer, subtotal, shippingCharge, discount, total } = req.body;

    if (!Array.isArray(cartItems) || cartItems.length === 0)
      return res.status(400).json({ error: 'Cart is empty' });

    if (!customer?.email)
      return res.status(400).json({ error: 'Customer details required' });

    if (!total || Number(total) < 1)
      return res.status(400).json({ error: 'Invalid order amount' });

    const items = cartItems.map(item => {
      const price    = Number(item.price);
      const quantity = Number(item.quantity);
      if (!price || !quantity) throw new Error('Invalid product price or quantity');
      return {
        productId:  item.id || item.productId || 'unknown',
        name:       item.name || 'Product',
        price,
        quantity,
        totalPrice: price * quantity
      };
    });

    const razorpayOrder = await razorpay.orders.create({
      amount:   Math.round(Number(total) * 100),
      currency: 'INR',
      receipt:  `VRK${Date.now()}`.slice(0, 40),
      notes: {
        customer_email: customer.email,
        customer_phone: customer.phone || ''
      }
    });

    const order = new Order({
      customer,
      items,
      subtotal:        Number(subtotal)       || 0,
      shippingCharge:  Number(shippingCharge) || 0,
      discount:        Number(discount)       || 0,
      total:           Number(total),
      paymentMethod:   'prepaid',
      paymentStatus:   'pending',
      orderStatus:     'pending',
      razorpayOrderId: razorpayOrder.id
    });
    await order.save();

    res.json({
      success:         true,
      razorpayOrderId: razorpayOrder.id,
      amount:          razorpayOrder.amount,
      currency:        razorpayOrder.currency,
      orderId:         order.orderId,
      customerName:    `${customer.firstName || ''} ${customer.lastName || ''}`.trim(),
      customerEmail:   customer.email,
      customerPhone:   customer.phone || ''
    });

  } catch (err) {
    const detail = err?.error || err?.response?.data || err?.message || String(err);
    console.error('❌ Razorpay initiate error:', JSON.stringify(detail));
    res.status(500).json({ error: 'Payment initiation failed. Please try again.' });
  }
});


// ── POST /api/payment/verify ──────────────────────────────────────────
router.post('/verify', async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

    console.log('🔍 Verify called — razorpay_order_id:', razorpay_order_id);

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature)
      return res.status(400).json({ success: false, error: 'Missing payment fields' });

    const body     = `${razorpay_order_id}|${razorpay_payment_id}`;
    const expected = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(body)
      .digest('hex');

    if (expected !== razorpay_signature) {
      console.error('❌ Signature mismatch');
      return res.status(400).json({ success: false, error: 'Invalid payment signature' });
    }

    const order = await Order.findOne({ razorpayOrderId: razorpay_order_id });

    if (!order) {
      console.error('❌ Order not found for razorpayOrderId:', razorpay_order_id);
      return res.status(404).json({ success: false, error: 'Order not found' });
    }

    order.paymentStatus     = 'completed';
    order.orderStatus       = 'confirmed';
    order.razorpayPaymentId = razorpay_payment_id;
    await order.save();

    console.log('✅ Payment verified — orderId:', order.orderId);

    shiprocket.createOrder(order)
      .then(async sr => {
        order.shiprocket  = { orderId: sr.order_id, shipmentId: sr.shipment_id };
        order.orderStatus = 'processing';
        await order.save();
        console.log('📦 Shiprocket order created:', sr.order_id);
      })
      .catch(e => console.error('⚠️ Shiprocket push failed:', e.message));

    sendOrderConfirmation(order)
      .catch(e => console.error('⚠️ Confirmation email failed:', e.message));

    res.json({ success: true, orderId: order.orderId });

  } catch (err) {
    console.error('❌ Verify error:', err.message);
    res.status(500).json({ success: false, error: 'Verification failed' });
  }
});


// ── POST /api/payment/cod-order ───────────────────────────────────────
router.post('/cod-order', async (req, res) => {
  try {
    const { cartItems, customer, subtotal, shippingCharge, discount, total } = req.body;

    if (!Array.isArray(cartItems) || cartItems.length === 0)
      return res.status(400).json({ error: 'Cart is empty' });

    if (!customer?.email)
      return res.status(400).json({ error: 'Customer details required' });

    const items = cartItems.map(item => ({
      productId:  item.id || item.productId || 'unknown',
      name:       item.name || 'Product',
      price:      Number(item.price),
      quantity:   Number(item.quantity),
      totalPrice: Number(item.price) * Number(item.quantity)
    }));

    const order = new Order({
      customer,
      items,
      subtotal:       Number(subtotal)       || 0,
      shippingCharge: Number(shippingCharge) || 0,
      discount:       Number(discount)       || 0,
      total:          Number(total),
      paymentMethod:  'cod',
      paymentStatus:  'pending',
      orderStatus:    'confirmed'
    });
    await order.save();

    console.log('✅ COD order saved:', order.orderId);

    shiprocket.createOrder(order)
      .then(async sr => {
        order.shiprocket  = { orderId: sr.order_id, shipmentId: sr.shipment_id };
        order.orderStatus = 'processing';
        await order.save();
      })
      .catch(e => console.error('⚠️ Shiprocket COD error:', e.message));

    sendOrderConfirmation(order)
      .catch(e => console.error('⚠️ COD email failed:', e.message));

    res.json({ success: true, orderId: order.orderId });

  } catch (err) {
    console.error('❌ COD error:', err.message);
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


// ── GET /api/payment/order-status ─────────────────────────────────────
// Called by order-confirmed.html to show real order details
router.get('/order-status', async (req, res) => {
  try {
    const { orderId } = req.query;
    if (!orderId) return res.status(400).json({ error: 'orderId required' });

    const order = await Order.findOne({ orderId });
    if (!order) return res.status(404).json({ error: 'Order not found' });

    // Return only what the confirmation page needs (no sensitive data)
    res.json({
      orderId:        order.orderId,
      paymentMethod:  order.paymentMethod,
      paymentStatus:  order.paymentStatus,
      orderStatus:    order.orderStatus,
      subtotal:       order.subtotal,
      shippingCharge: order.shippingCharge,
      discount:       order.discount,
      total:          order.total,
      customer: {
        firstName: order.customer.firstName,
        email:     order.customer.email
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
