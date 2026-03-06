// middleware/adminAuth.js
function requireAdmin(req, res, next) {
  if (req.session && req.session.isAdmin) {
    return next();
  }
  // API requests get 401, browser requests get redirect
  if (req.headers['content-type'] === 'application/json' || req.path.startsWith('/api/admin')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  res.redirect('/admin/login');
}

module.exports = { requireAdmin };
