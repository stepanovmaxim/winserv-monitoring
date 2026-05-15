const express = require('express');
const { passport, generateToken, ADMIN_EMAIL } = require('../auth');
const { requireAuth, requireAdmin } = require('../middleware/authMiddleware');
const db = require('../db');

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
  res.json(user);
});

router.get('/users', requireAuth, requireAdmin, async (req, res) => {
  const users = await db.queryAll(
    'SELECT id, email, name, avatar_url, role, created_at, approved_at FROM users ORDER BY created_at DESC'
  );
  res.json(users);
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
