const express = require('express');
const db = require('../db');
const { verifyToken } = require('../auth');
const { addClient } = require('../services/sseService');
const { getScope } = require('../services/scopeService');

const router = express.Router();

// EventSource cannot set Authorization headers, so the JWT arrives as ?token=.
router.get('/', async (req, res) => {
  let payload;
  try {
    payload = verifyToken(req.query.token || '');
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }
  // Role from the DB, not the token — a demoted account cannot keep a live
  // stream open on a stale 7-day token.
  const user = await db.queryOne('SELECT id, email, role FROM users WHERE id = $1', [payload.id]);
  if (!user) return res.status(401).json({ error: 'Account not found' });
  if (user.role !== 'admin' && user.role !== 'viewer') {
    return res.status(403).json({ error: 'Account not approved' });
  }

  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no', // stop nginx from buffering the stream
  });
  res.flushHeaders();
  res.write('retry: 5000\n\n');

  // Live events are filtered to this user's customers for the life of the stream.
  const scope = await getScope(user);
  addClient(res, scope);
});

module.exports = router;
