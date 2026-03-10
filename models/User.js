// models/User.js — User with phone OTP login + email/password
const mongoose = require('mongoose');
const bcrypt   = require('bcryptjs');

const userAddressSchema = new mongoose.Schema({
  label:     { type: String, default: 'Home' },
  firstName: String,
  lastName:  String,
  address:   String,
  address2:  String,
  city:      String,
  state:     String,
  pincode:   String,
  isDefault: { type: Boolean, default: false }
});

const userSchema = new mongoose.Schema({
  phone: {
    type:   String,
    unique: true,
    sparse: true,   // allow null (email-only accounts)
    index:  true
  },
  email:     { type: String, sparse: true, unique: true, lowercase: true, trim: true },
  password:  { type: String },   // bcrypt hash — only for email/password accounts
  firstName: { type: String },
  lastName:  { type: String },

  // OTP handling
  otp:          { type: String },
  otpExpiresAt: { type: Date },
  otpAttempts:  { type: Number, default: 0 },

  // Saved addresses
  addresses: [userAddressSchema],

  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
  lastLogin: { type: Date }
});

// Hash password before saving
userSchema.pre('save', async function(next) {
  this.updatedAt = new Date();
  if (!this.isModified('password') || !this.password) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

userSchema.methods.comparePassword = function(plain) {
  return bcrypt.compare(plain, this.password || '');
};

// Safe public view used in API responses
userSchema.methods.toPublic = function() {
  const defaultAddr = this.addresses.find(a => a.isDefault) || this.addresses[0] || null;
  return {
    phone:          this.phone,
    email:          this.email || '',
    firstName:      this.firstName || '',
    lastName:       this.lastName  || '',
    addresses:      this.addresses,
    defaultAddress: defaultAddr,
    hasPassword:    !!this.password
  };
};

userSchema.index({ phone: 1 });
userSchema.index({ email: 1 });

module.exports = mongoose.model('User', userSchema);
