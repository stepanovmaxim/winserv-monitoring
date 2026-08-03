const express = require('express');
const { passport, generateToken, ADMIN_EMAIL } = require('../auth');
const { requireAuth, requireAdmin } = require('../middleware/authMiddleware');
const db = require('../db');
const { getScope } = require('../services/scopeService');

const router = express.Router();

if (process.env.GOOGLE_CLIENT_ID) {
  router.get('/google',
    passport.authenticate('google', { scope: ['profile', 'email'] })
  );

  router.get('/google/callback',
    passport.authenticate('google', { session: false, failureRedirect: '/' }),
    (req, res) => {
      const token = generateToken(req.user);
      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
      res.redirect(`${frontendUrl}/auth-callback?token=${token}`);
    }
  );
}

router.post('/dev-login', async (req, res) => {
  if (process.env.GOOGLE_CLIENT_ID) {
    return res.status(404).json({ error: 'Use Google OAuth in production' });
  }
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'email required' });

  let user = await db.queryOne('SELECT * FROM users WHERE email = $1', [email]);
  if (!user) {
    const role = email.toLowerCase() === ADMIN_EMAIL.toLowerCase() ? 'admin' : 'approved';
    const result = await db.query(
      "INSERT INTO users (google_id, email, name, role) VALUES ($1, $2, $3, $4) RETURNING id",
      ['dev-' + email, email, email.split('@')[0], role]
    );
    user = await db.queryOne('SELECT * FROM users WHERE id = $1', [result.rows[0].id]);
  }
  res.json({ token: generateToken(user), user });
});

router.get('/me', requireAuth, async (req, res) => {
  const user = await db.queryOne(
    'SELECT id, google_id, email, name, avatar_url, role, created_at FROM users WHERE id = $1',
    [req.user.id]
  );
  if (!user) return res.status(404).json({ error: 'User not found' });
  // scope: null = sees everything; array = restricted to those customers.
  const scope = await getScope(req.user);
  res.json({ ...user, customer_scope: scope });
});

router.get('/users', requireAuth, requireAdmin, async (req, res) => {
  const users = await db.queryAll(
    `SELECT u.id, u.email, u.name, u.avatar_url, u.role, u.created_at, u.approved_at,
       COALESCE(ARRAY_AGG(uc.customer_id) FILTER (WHERE uc.customer_id IS NOT NULL), '{}') AS customer_ids
     FROM users u LEFT JOIN user_customers uc ON uc.user_id = u.id
     GROUP BY u.id ORDER BY u.created_at DESC`
  );
  res.json(users);
});

// Assign which customers a user may see. An empty list means "all customers"
// (the historical behaviour), so existing admins are unaffected by this feature.
router.put('/users/:id/customers', requireAuth, requireAdmin, async (req, res) => {
  const { id } = req.params;
  const ids = Array.isArray(req.body.customer_ids) ? req.body.customer_ids.map(Number).filter(Number.isFinite) : [];

  const user = await db.queryOne('SELECT * FROM users WHERE id = $1', [id]);
  if (!user) return res.status(404).json({ error: 'User not found' });
  // The primary admin must always keep full access, or the instance can be
  // locked out of its own tenants.
  if (user.email.toLowerCase() === ADMIN_EMAIL.toLowerCase() && ids.length) {
    return res.status(400).json({ error: 'The primary admin cannot be restricted to specific customers' });
  }
  // A restricted admin must not be able to widen anyone's access beyond their own.
  const actorScope = await getScope(req.user);
  if (actorScope !== null) {
    const bad = ids.filter(cid => !actorScope.includes(cid));
    if (bad.length) return res.status(403).json({ error: 'You can only assign customers you manage yourself' });
  }

  await db.query('DELETE FROM user_customers WHERE user_id = $1', [id]);
  for (const cid of ids) {
    await db.query('INSERT INTO user_customers (user_id, customer_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [id, cid]);
  }
  res.json({ success: true, count: ids.length });
});

router.put('/users/:id/role', requireAuth, requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { role } = req.body;
  if (!['admin', 'viewer', 'pending'].includes(role)) {
    return res.status(400).json({ error: 'Invalid role' });
  }
  const user = await db.queryOne('SELECT * FROM users WHERE id = $1', [id]);
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (user.email.toLowerCase() === ADMIN_EMAIL.toLowerCase()) {
    return res.status(400).json({ error: 'Cannot change primary admin role' });
  }
  await db.query("UPDATE users SET role = $1, approved_at = NOW() WHERE id = $2", [role, id]);
  res.json({ success: true });
});

module.exports = router;
