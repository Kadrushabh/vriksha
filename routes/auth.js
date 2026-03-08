// routes/auth.js — Phone OTP Login & User Account
const express = require('express');
const User    = require('../models/User');
const Order   = require('../models/Order');

const router = express.Router();

// ── Generate 6-digit OTP ──────────────────────────────────────────────
function generateOTP() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

// ── POST /api/auth/send-otp ───────────────────────────────────────────
// In production, integrate with MSG91 / Twilio / 2Factor.in for real SMS
router.post('/send-otp', async (req, res) => {
  try {
    const { phone } = req.body;
    if (!phone || !/^\d{10}$/.test(phone)) {
      return res.status(400).json({ error: 'Valid 10-digit phone number required' });
    }

    const otp = generateOTP();
    const otpExpiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 min

    // Upsert user
    let user = await User.findOne({ phone });
    if (!user) {
      user = new User({ phone });
    }
    
    // Rate limit: max 5 OTP requests per 10 minutes
    if (user.otpAttempts >= 5 && user.otpExpiresAt > new Date()) {
      return res.status(429).json({ error: 'Too many OTP requests. Try again later.' });
    }

    user.otp = otp;
    user.otpExpiresAt = otpExpiresAt;
    user.otpAttempts = (user.otpAttempts || 0) + 1;
    await user.save();

    // ── Send OTP via SMS ──────────────────────────────────────────────
    // For production: integrate MSG91, 2Factor.in, or Twilio
    // Example with 2Factor.in:
    //   await axios.get(`https://2factor.in/API/V1/${process.env.TWO_FACTOR_API_KEY}/SMS/${phone}/${otp}/OTP1`);
    
    // For now, log OTP (REMOVE IN PRODUCTION)
    console.log(`📱 OTP for ${phone}: ${otp}`);

    // In dev/test mode, also return OTP in response
    const isDev = process.env.NODE_ENV !== 'production';
    
    res.json({
      success: true,
      message: 'OTP sent successfully',
      ...(isDev && { otp }) // Only in dev mode for testing
    });

  } catch (err) {
    console.error('Send OTP error:', err.message);
    res.status(500).json({ error: 'Could not send OTP. Please try again.' });
  }
});


// ── POST /api/auth/verify-otp ─────────────────────────────────────────
router.post('/verify-otp', async (req, res) => {
  try {
    const { phone, otp } = req.body;
    if (!phone || !otp) {
      return res.status(400).json({ error: 'Phone and OTP required' });
    }

    const user = await User.findOne({ phone });
    if (!user) {
      return res.status(404).json({ error: 'Phone number not found. Request OTP first.' });
    }

    if (!user.otp || !user.otpExpiresAt) {
      return res.status(400).json({ error: 'No OTP requested. Send OTP first.' });
    }

    if (new Date() > user.otpExpiresAt) {
      return res.status(400).json({ error: 'OTP expired. Request a new one.' });
    }

    if (user.otp !== otp) {
      return res.status(400).json({ error: 'Invalid OTP. Please try again.' });
    }

    // OTP verified — clear it
    user.otp = undefined;
    user.otpExpiresAt = undefined;
    user.otpAttempts = 0;
    user.lastLogin = new Date();
    await user.save();

    // Set session
    req.session.userId = user._id.toString();
    req.session.phone = user.phone;

    // Load saved addresses
    const defaultAddr = user.addresses.find(a => a.isDefault) || user.addresses[0] || null;

    res.json({
      success: true,
      user: {
        phone:     user.phone,
        firstName: user.firstName || '',
        lastName:  user.lastName || '',
        email:     user.email || '',
        addresses: user.addresses,
        defaultAddress: defaultAddr
      }
    });

  } catch (err) {
    console.error('Verify OTP error:', err.message);
    res.status(500).json({ error: 'Verification failed. Please try again.' });
  }
});


// ── GET /api/auth/me — Get current user session ──────────────────────
router.get('/me', async (req, res) => {
  try {
    if (!req.session?.userId) {
      return res.json({ loggedIn: false });
    }
    const user = await User.findById(req.session.userId);
    if (!user) {
      return res.json({ loggedIn: false });
    }

    const defaultAddr = user.addresses.find(a => a.isDefault) || user.addresses[0] || null;

    res.json({
      loggedIn: true,
      user: {
        phone:     user.phone,
        firstName: user.firstName || '',
        lastName:  user.lastName || '',
        email:     user.email || '',
        addresses: user.addresses,
        defaultAddress: defaultAddr
      }
    });
  } catch (err) {
    res.json({ loggedIn: false });
  }
});


// ── POST /api/auth/logout ─────────────────────────────────────────────
router.post('/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});


// ── PUT /api/auth/profile — Update user profile ──────────────────────
router.put('/profile', async (req, res) => {
  try {
    if (!req.session?.userId) {
      return res.status(401).json({ error: 'Not logged in' });
    }

    const { firstName, lastName, email } = req.body;
    const user = await User.findById(req.session.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    if (firstName) user.firstName = firstName;
    if (lastName) user.lastName = lastName;
    if (email) user.email = email;
    await user.save();

    res.json({ success: true, user: { firstName: user.firstName, lastName: user.lastName, email: user.email } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// ── POST /api/auth/address — Save address ────────────────────────────
router.post('/address', async (req, res) => {
  try {
    if (!req.session?.userId) {
      return res.status(401).json({ error: 'Not logged in' });
    }

    const user = await User.findById(req.session.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const { label, firstName, lastName, address, address2, city, state, pincode, isDefault } = req.body;

    // If setting as default, unset existing default
    if (isDefault) {
      user.addresses.forEach(a => a.isDefault = false);
    }

    user.addresses.push({ label, firstName, lastName, address, address2, city, state, pincode, isDefault: isDefault || user.addresses.length === 0 });
    await user.save();

    res.json({ success: true, addresses: user.addresses });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// ── DELETE /api/auth/address/:id — Remove address ────────────────────
router.delete('/address/:id', async (req, res) => {
  try {
    if (!req.session?.userId) {
      return res.status(401).json({ error: 'Not logged in' });
    }

    const user = await User.findById(req.session.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    user.addresses = user.addresses.filter(a => a._id.toString() !== req.params.id);
    await user.save();

    res.json({ success: true, addresses: user.addresses });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// ── GET /api/auth/orders — User's order history ──────────────────────
router.get('/orders', async (req, res) => {
  try {
    if (!req.session?.phone) {
      return res.status(401).json({ error: 'Not logged in' });
    }

    const orders = await Order.find({ 'customer.phone': req.session.phone })
      .sort({ createdAt: -1 })
      .limit(20)
      .select('orderId items total orderStatus paymentMethod paymentStatus createdAt shiprocket.trackingUrl shiprocket.awbCode');

    res.json({ orders });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


module.exports = router;
