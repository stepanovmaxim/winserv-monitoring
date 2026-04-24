const { verifyToken } = require('../auth');

function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    req.user = verifyToken(header.slice(7));
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

function requireApproved(req, res, next) {
  if (req.user?.role !== 'admin' && req.user?.role !== 'approved') {
    return res.status(403).json({ error: 'Account not approved' });
  }
  next();
}

module.exports = { requireAuth, requireAdmin, requireApproved };
