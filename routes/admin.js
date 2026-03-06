// routes/admin.js  —  Admin panel API & page routes
const express  = require('express');
const Order    = require('../models/Order');
const shiprocket = require('../config/shiprocket');
const { requireAdmin } = require('../middleware/adminAuth');
const { sendShippingUpdate } = require('../config/mailer');

const router = express.Router();

// ── Admin Login ───────────────────────────────────────────────────────
router.post('/login', (req, res) => {
  const { email, password } = req.body;
  if (email === process.env.ADMIN_EMAIL && password === process.env.ADMIN_PASSWORD) {
    req.session.isAdmin = true;
    return res.json({ success: true });
  }
  res.status(401).json({ error: 'Invalid credentials' });
});

router.post('/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

router.get('/check-auth', (req, res) => {
  res.json({ authenticated: !!req.session?.isAdmin });
});

// ── All routes below require admin auth ──────────────────────────────
router.use(requireAdmin);

// ── GET /api/admin/orders — list with filters ─────────────────────────
router.get('/orders', async (req, res) => {
  try {
    const { status, page = 1, limit = 20, search } = req.query;
    const query = {};

    if (status && status !== 'all') query.orderStatus = status;
    if (search) {
      query.$or = [
        { orderId: new RegExp(search, 'i') },
        { 'customer.email': new RegExp(search, 'i') },
        { 'customer.phone': new RegExp(search, 'i') },
        { 'customer.firstName': new RegExp(search, 'i') }
      ];
    }

    const [orders, total] = await Promise.all([
      Order.find(query).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(+limit),
      Order.countDocuments(query)
    ]);

    // Stats for dashboard
    const stats = await Order.aggregate([
      { $group: {
        _id: '$orderStatus',
        count: { $sum: 1 },
        revenue: { $sum: '$total' }
      }}
    ]);

    res.json({ orders, total, page: +page, stats });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/admin/orders/:orderId — single order detail ──────────────
router.get('/orders/:orderId', async (req, res) => {
  try {
    const order = await Order.findOne({ orderId: req.params.orderId });
    if (!order) return res.status(404).json({ error: 'Order not found' });
    res.json(order);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PATCH /api/admin/orders/:orderId/status — update order status ─────
router.patch('/orders/:orderId/status', async (req, res) => {
  try {
    const { status, adminNotes } = req.body;
    const validStatuses = ['pending','confirmed','processing','shipped','delivered','cancelled','returned'];
    if (!validStatuses.includes(status)) return res.status(400).json({ error: 'Invalid status' });

    const order = await Order.findOneAndUpdate(
      { orderId: req.params.orderId },
      { orderStatus: status, ...(adminNotes && { adminNotes }) },
      { new: true }
    );
    if (!order) return res.status(404).json({ error: 'Order not found' });

    res.json({ success: true, order });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/admin/orders/:orderId/shiprocket-sync ───────────────────
// Push order to Shiprocket manually (if auto-push failed)
router.post('/orders/:orderId/shiprocket-sync', async (req, res) => {
  try {
    const order = await Order.findOne({ orderId: req.params.orderId });
    if (!order) return res.status(404).json({ error: 'Order not found' });

    const srRes = await shiprocket.createOrder(order);
    order.shiprocket = { orderId: srRes.order_id, shipmentId: srRes.shipment_id, status: srRes.status };
    order.orderStatus = 'processing';
    await order.save();

    res.json({ success: true, shiprocket: order.shiprocket });
  } catch (err) {
    res.status(500).json({ error: `Shiprocket sync failed: ${err.message}` });
  }
});

// ── POST /api/admin/orders/:orderId/assign-awb ────────────────────────
router.post('/orders/:orderId/assign-awb', async (req, res) => {
  try {
    const { courierId } = req.body;
    const order = await Order.findOne({ orderId: req.params.orderId });
    if (!order?.shiprocket?.shipmentId) return res.status(400).json({ error: 'No shipment ID. Sync with Shiprocket first.' });

    const awbRes = await shiprocket.assignAWB(order.shiprocket.shipmentId, courierId);
    order.shiprocket.awbCode      = awbRes.awb_code;
    order.shiprocket.courierId    = courierId;
    order.shiprocket.courierName  = awbRes.courier_name;
    order.shiprocket.trackingUrl  = awbRes.tracking_url || `https://shiprocket.co/tracking/${awbRes.awb_code}`;
    order.orderStatus = 'shipped';
    await order.save();

    // Notify customer
    sendShippingUpdate(order);

    res.json({ success: true, awbCode: awbRes.awb_code, trackingUrl: order.shiprocket.trackingUrl });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/admin/orders/:orderId/track ──────────────────────────────
router.get('/orders/:orderId/track', async (req, res) => {
  try {
    const order = await Order.findOne({ orderId: req.params.orderId });
    if (!order?.shiprocket?.awbCode) return res.status(400).json({ error: 'No AWB assigned yet' });

    const tracking = await shiprocket.trackShipment(order.shiprocket.awbCode);
    res.json(tracking);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/admin/orders/:orderId/cancel ────────────────────────────
router.post('/orders/:orderId/cancel', async (req, res) => {
  try {
    const order = await Order.findOne({ orderId: req.params.orderId });
    if (!order) return res.status(404).json({ error: 'Order not found' });

    if (order.shiprocket?.orderId) {
      await shiprocket.cancelOrder(order.shiprocket.orderId);
    }
    order.orderStatus = 'cancelled';
    await order.save();

    res.json({ success: true, message: 'Order cancelled' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/admin/dashboard ──────────────────────────────────────────
router.get('/dashboard', async (req, res) => {
  try {
    const today = new Date(); today.setHours(0,0,0,0);
    const thisMonth = new Date(today.getFullYear(), today.getMonth(), 1);

    const [
      totalOrders, pendingOrders, todayOrders,
      totalRevenue, monthRevenue
    ] = await Promise.all([
      Order.countDocuments(),
      Order.countDocuments({ orderStatus: { $in: ['pending','confirmed','processing'] } }),
      Order.countDocuments({ createdAt: { $gte: today } }),
      Order.aggregate([{ $match: { paymentStatus: 'completed' }}, { $group: { _id: null, sum: { $sum: '$total' }}}]),
      Order.aggregate([{ $match: { paymentStatus: 'completed', createdAt: { $gte: thisMonth }}}, { $group: { _id: null, sum: { $sum: '$total' }}}])
    ]);

    const recentOrders = await Order.find().sort({ createdAt: -1 }).limit(5);

    res.json({
      totalOrders,
      pendingOrders,
      todayOrders,
      totalRevenue:  totalRevenue[0]?.sum  || 0,
      monthRevenue:  monthRevenue[0]?.sum   || 0,
      recentOrders
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
