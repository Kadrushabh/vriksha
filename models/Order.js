// models/Order.js
const mongoose = require('mongoose');

const orderItemSchema = new mongoose.Schema({
  productId:  { type: String, required: true },
  name:       { type: String, required: true },
  sku:        { type: String },
  quantity:   { type: Number, required: true, min: 1 },
  price:      { type: Number, required: true },
  totalPrice: { type: Number, required: true }
});

const addressSchema = new mongoose.Schema({
  firstName: { type: String, required: true },
  lastName:  { type: String, required: true },
  address:   { type: String, required: true },
  city:      { type: String, required: true },
  state:     { type: String, required: true },
  pincode:   { type: String, required: true },
  phone:     { type: String, required: true },
  email:     { type: String, required: true }
});

const orderSchema = new mongoose.Schema({
  orderId: {
    type: String,
    unique: true,
    default: () => `VRK-${Date.now()}-${Math.floor(Math.random() * 1000)}`
  },

  customer: addressSchema,

  items:         [orderItemSchema],
  subtotal:      { type: Number, required: true },
  shippingCharge:{ type: Number, default: 0 },
  discount:      { type: Number, default: 0 },
  total:         { type: Number, required: true },

  couponCode:    { type: String },

  // Payment
  paymentMethod: {
    type: String,
    enum: ['prepaid', 'cod'],
    default: 'prepaid'
  },
  paymentStatus: {
    type: String,
    enum: ['pending', 'completed', 'failed', 'refunded'],
    default: 'pending'
  },
  razorpayOrderId:   { type: String },
  razorpayPaymentId: { type: String },

  // Shipping
  orderStatus: {
    type: String,
    enum: ['pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled', 'returned'],
    default: 'pending'
  },
  shiprocket: {
    orderId:    { type: String },
    shipmentId: { type: String },
    awbCode:    { type: String },
    courierId:  { type: String },
    courierName:{ type: String },
    trackingUrl:{ type: String },
    status:     { type: String }
  },

  notes:          { type: String },
  adminNotes:     { type: String },

  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

orderSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

// Indexes for fast admin queries
orderSchema.index({ orderId: 1 });
orderSchema.index({ 'customer.email': 1 });
orderSchema.index({ orderStatus: 1 });
orderSchema.index({ createdAt: -1 });

module.exports = mongoose.model('Order', orderSchema);
