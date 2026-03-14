// server.js — Vriksha Backend
require('dotenv').config();

const express   = require('express');
const mongoose  = require('mongoose');
const cors      = require('cors');
const helmet    = require('helmet');
const session   = require('express-session');
const rateLimit = require('express-rate-limit');
const path      = require('path');

const paymentRoutes = require('./routes/payment');
const adminRoutes   = require('./routes/admin');
const authRoutes    = require('./routes/auth');

const app  = express();
const PORT = process.env.PORT || 3000;

app.set('trust proxy', 1);

// ── CORS — must be FIRST before everything else ───────────────────────
const corsOptions = {
  origin: ['https://vriksha.store', 'https://www.vriksha.store', 'http://localhost:3000'],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
};
app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

// ── Security ──────────────────────────────────────────────────────────
app.use(helmet({ contentSecurityPolicy: false }));

app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { error: 'Too many requests, please try again later.' }
}));

// ── Body parsing ──────────────────────────────────────────────────────
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true }));

// ── Sessions ──────────────────────────────────────────────────────────
app.use(session({
  secret:            process.env.SESSION_SECRET || 'vriksha-secret-2026',
  resave:            false,
  saveUninitialized: false,
  cookie: {
    secure:   process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge:   8 * 60 * 60 * 1000
  }
}));

// ── Static files ──────────────────────────────────────────────────────
app.use('/admin', express.static(path.join(__dirname, 'public/admin')));

// ── Routes ────────────────────────────────────────────────────────────
app.use('/api/payment', paymentRoutes);
app.use('/api/admin',   adminRoutes);
app.use('/api/auth',    authRoutes);

// ── Health check ──────────────────────────────────────────────────────
// TEMP: Test Shiprocket auth directly
app.get('/test-shiprocket', async (req, res) => {
  const axios = require('axios');
  try {
    const r = await axios.post('https://apiv2.shiprocket.in/v1/external/auth/login', {
      email:    process.env.SHIPROCKET_EMAIL,
      password: process.env.SHIPROCKET_PASSWORD
    });
    res.json({ success: true, email: process.env.SHIPROCKET_EMAIL, token_preview: r.data.token?.substring(0,20) + '...' });
  } catch(e) {
    res.json({ success: false, email: process.env.SHIPROCKET_EMAIL, error: e?.response?.data || e.message });
  }
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', brand: 'Vriksha', time: new Date().toISOString() });
});

app.get('/test-razorpay', (req, res) => {
  try {
    const Razorpay = require('razorpay');
    res.json({ status: 'razorpay loaded', version: require('razorpay/package.json').version });
  } catch(e) {
    res.json({ status: 'razorpay NOT found', error: e.message });
  }
});

// ── Admin SPA fallback ────────────────────────────────────────────────
app.get('/admin/*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/admin/index.html'));
});

// ── 404 ───────────────────────────────────────────────────────────────
app.use((req, res) => res.status(404).json({ error: 'Not found' }));

// ── Error handler ─────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('Error:', err.message);
  res.status(500).json({ error: 'Internal server error' });
});

// ── Connect DB & Start ────────────────────────────────────────────────
mongoose.connect(process.env.MONGODB_URI)
  .then(() => {
    console.log('✅  MongoDB connected');
    app.listen(PORT, () => {
      console.log(`✅  Vriksha backend running on port ${PORT}`);
      console.log(`🌿  Admin panel: http://localhost:${PORT}/admin`);
      console.log(`💚  Health check: http://localhost:${PORT}/health`);

      // ── Keep-alive: prevent Railway free-tier from sleeping ─────────
      // Pings /health every 10 minutes so the server stays warm.
      // Without this, Railway sleeps after ~5 min and takes 10-15s to
      // wake up — causing "Failed to fetch" on the first payment attempt.
      const SELF_URL = process.env.RAILWAY_PUBLIC_DOMAIN
        ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
        : `https://vriksha-production.up.railway.app`;

      setInterval(() => {
        fetch(SELF_URL + '/health')
          .then(r => r.json())
          .then(() => console.log('🏓 Keep-alive ping sent'))
          .catch(err => console.warn('⚠️  Keep-alive ping failed:', err.message));
      }, 10 * 60 * 1000); // every 10 minutes

      console.log(`🏓  Keep-alive active → pinging ${SELF_URL}/health every 10 min`);
    });
  })
  .catch(err => {
    console.error('❌  MongoDB connection failed:', err.message);
    process.exit(1);
  });
