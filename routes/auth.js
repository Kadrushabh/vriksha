// routes/auth.js — Phone OTP Login + Email/Password Auth
const express = require('express');
const User    = require('../models/User');
const Order   = require('../models/Order');

const router = express.Router();

// ── Helpers ───────────────────────────────────────────────────────────
function generateOTP() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function requireLogin(req, res, next) {
  if (!req.session?.userId) return res.status(401).json({ error: 'Not logged in' });
  next();
}


// ══════════════════════════════════════════════════════════════════════
// PHONE OTP AUTH (existing)
// ══════════════════════════════════════════════════════════════════════

// ── POST /api/auth/send-otp ───────────────────────────────────────────
router.post('/send-otp', async (req, res) => {
  try {
    const { phone } = req.body;
    if (!phone || !/^\d{10}$/.test(phone)) {
      return res.status(400).json({ error: 'Valid 10-digit phone number required' });
    }

    const otp          = generateOTP();
    const otpExpiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 min

    let user = await User.findOne({ phone });
    if (!user) {
      user = new User({ phone });
    }

    // Rate limit: max 5 OTP requests per 10 minutes
    if (user.otpAttempts >= 5 && user.otpExpiresAt > new Date()) {
      return res.status(429).json({ error: 'Too many OTP requests. Try again later.' });
    }

    user.otp         = otp;
    user.otpExpiresAt = otpExpiresAt;
    user.otpAttempts = (user.otpAttempts || 0) + 1;
    await user.save();

    // Production SMS integration:
    // await axios.get(`https://2factor.in/API/V1/${process.env.TWO_FACTOR_API_KEY}/SMS/${phone}/${otp}/OTP1`);

    console.log(`📱 OTP for ${phone}: ${otp}`);

    const isDev = process.env.NODE_ENV !== 'production';
    res.json({
      success: true,
      message: 'OTP sent successfully',
      ...(isDev && { otp })
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
    if (!user)                    return res.status(404).json({ error: 'Phone number not found. Request OTP first.' });
    if (!user.otp || !user.otpExpiresAt) return res.status(400).json({ error: 'No OTP requested. Send OTP first.' });
    if (new Date() > user.otpExpiresAt)  return res.status(400).json({ error: 'OTP expired. Request a new one.' });
    if (user.otp !== otp)                return res.status(400).json({ error: 'Invalid OTP. Please try again.' });

    user.otp          = undefined;
    user.otpExpiresAt = undefined;
    user.otpAttempts  = 0;
    user.lastLogin    = new Date();
    await user.save();

    req.session.userId = user._id.toString();
    req.session.phone  = user.phone;

    res.json({ success: true, user: user.toPublic() });

  } catch (err) {
    console.error('Verify OTP error:', err.message);
    res.status(500).json({ error: 'Verification failed. Please try again.' });
  }
});


// ══════════════════════════════════════════════════════════════════════
// EMAIL / PASSWORD AUTH (new)
// ══════════════════════════════════════════════════════════════════════

// ── POST /api/auth/register ───────────────────────────────────────────
router.post('/register', async (req, res) => {
  try {
    const { firstName, lastName, email, phone, password } = req.body;

    if (!firstName || !email || !password)
      return res.status(400).json({ error: 'First name, email and password are required' });
    if (password.length < 8)
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      return res.status(400).json({ error: 'Enter a valid email address' });

    // Duplicate email check
    const existingEmail = await User.findOne({ email: email.toLowerCase().trim() });
    if (existingEmail)
      return res.status(400).json({ error: 'An account with this email already exists' });

    // Optional phone check
    const cleanPhone = phone ? String(phone).replace(/\D/g, '') : null;
    if (cleanPhone) {
      if (!/^\d{10}$/.test(cleanPhone))
        return res.status(400).json({ error: 'Enter a valid 10-digit phone number' });
      const existingPhone = await User.findOne({ phone: cleanPhone });
      if (existingPhone)
        return res.status(400).json({ error: 'This phone number is already registered' });
    }

    const user = new User({
      firstName: firstName.trim(),
      lastName:  (lastName || '').trim(),
      email:     email.toLowerCase().trim(),
      phone:     cleanPhone || undefined,
      password                               // hashed by pre-save hook
    });
    await user.save();

    req.session.userId = user._id.toString();
    req.session.phone  = user.phone || null;

    res.json({ success: true, user: user.toPublic() });

  } catch (err) {
    console.error('Register error:', err.message);
    if (err.code === 11000) {
      const field = Object.keys(err.keyPattern || {})[0] || 'field';
      return res.status(400).json({ error: `This ${field} is already registered` });
    }
    res.status(500).json({ error: 'Registration failed. Please try again.' });
  }
});


// ── POST /api/auth/login ──────────────────────────────────────────────
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password)
      return res.status(400).json({ error: 'Email and password are required' });

    const user = await User.findOne({ email: email.toLowerCase().trim() });
    if (!user || !user.password)
      return res.status(401).json({ error: 'No account found with this email' });

    const match = await user.comparePassword(password);
    if (!match)
      return res.status(401).json({ error: 'Incorrect password' });

    user.lastLogin = new Date();
    await user.save();

    req.session.userId = user._id.toString();
    req.session.phone  = user.phone || null;

    res.json({ success: true, user: user.toPublic() });

  } catch (err) {
    console.error('Login error:', err.message);
    res.status(500).json({ error: 'Login failed. Please try again.' });
  }
});


// ── PUT /api/auth/change-password ─────────────────────────────────────
router.put('/change-password', requireLogin, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!newPassword || newPassword.length < 8)
      return res.status(400).json({ error: 'New password must be at least 8 characters' });

    const user = await User.findById(req.session.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    // If user already has a password, verify current one first
    if (user.password) {
      if (!currentPassword)
        return res.status(400).json({ error: 'Current password is required' });
      const match = await user.comparePassword(currentPassword);
      if (!match)
        return res.status(401).json({ error: 'Current password is incorrect' });
    }

    user.password = newPassword; // pre-save hook hashes it
    await user.save();

    res.json({ success: true });

  } catch (err) {
    console.error('Change password error:', err.message);
    res.status(500).json({ error: 'Could not update password' });
  }
});


// ══════════════════════════════════════════════════════════════════════
// SHARED / PROFILE ENDPOINTS
// ══════════════════════════════════════════════════════════════════════

// ── GET /api/auth/me ──────────────────────────────────────────────────
router.get('/me', async (req, res) => {
  try {
    if (!req.session?.userId) return res.json({ loggedIn: false });
    const user = await User.findById(req.session.userId);
    if (!user) return res.json({ loggedIn: false });
    res.json({ loggedIn: true, user: user.toPublic() });
  } catch (err) {
    res.json({ loggedIn: false });
  }
});


// ── POST /api/auth/logout ─────────────────────────────────────────────
router.post('/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});


// ── GET /api/auth/profile ─────────────────────────────────────────────
router.get('/profile', requireLogin, async (req, res) => {
  try {
    const user = await User.findById(req.session.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ success: true, user: user.toPublic() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// ── PUT /api/auth/profile ─────────────────────────────────────────────
router.put('/profile', requireLogin, async (req, res) => {
  try {
    const { firstName, lastName, email } = req.body;
    const user = await User.findById(req.session.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    if (firstName)          user.firstName = firstName.trim();
    if (lastName !== undefined) user.lastName = lastName.trim();
    if (email) {
      const emailClean = email.toLowerCase().trim();
      if (emailClean !== user.email) {
        const dup = await User.findOne({ email: emailClean, _id: { $ne: user._id } });
        if (dup) return res.status(400).json({ error: 'Email already in use by another account' });
        user.email = emailClean;
      }
    }
    await user.save();

    res.json({ success: true, user: user.toPublic() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// ── POST /api/auth/address — Save address ────────────────────────────
router.post('/address', requireLogin, async (req, res) => {
  try {
    const user = await User.findById(req.session.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const { label, firstName, lastName, address, address2, city, state, pincode, isDefault } = req.body;

    if (isDefault) {
      user.addresses.forEach(a => a.isDefault = false);
    }

    user.addresses.push({
      label, firstName, lastName, address, address2, city, state, pincode,
      isDefault: isDefault || user.addresses.length === 0
    });
    await user.save();

    res.json({ success: true, addresses: user.addresses });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// ── DELETE /api/auth/address/:id ─────────────────────────────────────
router.delete('/address/:id', requireLogin, async (req, res) => {
  try {
    const user = await User.findById(req.session.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    user.addresses = user.addresses.filter(a => a._id.toString() !== req.params.id);
    await user.save();

    res.json({ success: true, addresses: user.addresses });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// ── GET /api/auth/orders ──────────────────────────────────────────────
router.get('/orders', requireLogin, async (req, res) => {
  try {
    const user = await User.findById(req.session.userId);
    if (!user) return res.status(401).json({ error: 'Not logged in' });

    // Look up orders by phone OR email — covers both auth methods
    const query = [];
    if (user.phone) query.push({ 'customer.phone': user.phone });
    if (user.email) query.push({ 'customer.email': user.email });

    const orders = await Order.find(query.length ? { $or: query } : { _id: null })
      .sort({ createdAt: -1 })
      .limit(50)
      .select('orderId items total orderStatus paymentMethod paymentStatus createdAt shiprocket');

    res.json({ orders });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


module.exports = router;
