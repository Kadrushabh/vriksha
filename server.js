// server.js  —  Vriksha Backend Entry Point
require('dotenv').config();

const express     = require('express');
const mongoose    = require('mongoose');
const cors        = require('cors');
const helmet      = require('helmet');
const session     = require('express-session');
const rateLimit   = require('express-rate-limit');
const path        = require('path');

const paymentRoutes = require('./routes/payment');
const adminRoutes   = require('./routes/admin');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Security middleware ───────────────────────────────────────────────
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({
  origin: [
    'https://vriksha.in',
    'https://www.vriksha.in',
    'http://localhost:5500',  // For local dev with Live Server
    'http://127.0.0.1:5500'
  ],
  credentials: true
}));

// Rate limiting — prevent abuse
app.use('/api/payment', rateLimit({
  windowMs: 15 * 60 * 1000,  // 15 min
  max: 20,
  message: { error: 'Too many requests, please try again later.' }
}));

// ── Body parsing ──────────────────────────────────────────────────────
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true }));

// ── Sessions (for admin panel) ────────────────────────────────────────
app.use(session({
  secret:            process.env.SESSION_SECRET || 'vriksha-secret-change-this',
  resave:            false,
  saveUninitialized: false,
  cookie: {
    secure:   process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge:   8 * 60 * 60 * 1000   // 8 hours
  }
}));

// ── Static files (admin panel) ────────────────────────────────────────
app.use('/admin', express.static(path.join(__dirname, 'public/admin')));

// ── API Routes ────────────────────────────────────────────────────────
app.use('/api/payment', paymentRoutes);
app.use('/api/admin',   adminRoutes);

// ── Health check ──────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    brand:  'Vriksha',
    time:   new Date().toISOString()
  });
});

// ── Serve admin panel SPA ─────────────────────────────────────────────
app.get('/admin/*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/admin/index.html'));
});

// ── 404 handler ───────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// ── Error handler ─────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// ── Database + Start ──────────────────────────────────────────────────
mongoose.connect(process.env.MONGODB_URI)
  .then(() => {
    console.log('✅  MongoDB connected');
    app.listen(PORT, () => {
      console.log(`
╔══════════════════════════════════════╗
║   ❧  VRIKSHA Backend Running         ║
║   Port: ${PORT}                         ║
║   Admin: http://localhost:${PORT}/admin  ║
║   Health: http://localhost:${PORT}/health║
╚══════════════════════════════════════╝`);
    });
  })
  .catch(err => {
    console.error('❌  MongoDB connection failed:', err.message);
    process.exit(1);
  });
