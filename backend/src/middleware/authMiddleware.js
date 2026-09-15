const { verifyToken } = require('../auth');
const db = require('../db');

async function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  let payload;
  try {
    payload = verifyToken(header.slice(7));
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }
  // Authorization reflects the CURRENT database state, never the 7-day token: a
  // demotion or a deleted account takes effect on the very next request, and a
  // stale role baked into a token can never grant access it no longer has. The
  // token only proves identity; the role is always read fresh.
  try {
    const u = await db.queryOne('SELECT id, email, name, avatar_url, role FROM users WHERE id = $1', [payload.id]);
    if (!u) return res.status(401).json({ error: 'Account not found' });
    req.user = u;
    next();
  } catch (err) {
    return res.status(500).json({ error: 'Auth check failed' });
  }
}

function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

function requireApproved(req, res, next) {
  if (req.user?.role !== 'admin' && req.user?.role !== 'viewer') {
    return res.status(403).json({ error: 'Account not approved' });
  }
  next();
}

module.exports = { requireAuth, requireAdmin, requireApproved };
