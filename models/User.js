// models/User.js — User with phone OTP login
const mongoose = require('mongoose');

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
    type:     String,
    required: true,
    unique:   true,
    index:    true
  },
  email:     { type: String, sparse: true },
  firstName: { type: String },
  lastName:  { type: String },

  // OTP handling
  otp:          { type: String },
  otpExpiresAt: { type: Date },
  otpAttempts:  { type: Number, default: 0 },

  // Saved addresses
  addresses: [userAddressSchema],

  // Order history is queried from Order model via phone

  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
  lastLogin: { type: Date }
});

userSchema.pre('save', function (next) {
  this.updatedAt = new Date();
  next();
});

userSchema.index({ phone: 1 });
userSchema.index({ email: 1 });

module.exports = mongoose.model('User', userSchema);
