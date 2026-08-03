const express = require('express');
const { verifyToken } = require('../auth');
const { addClient } = require('../services/sseService');
const { getScope } = require('../services/scopeService');

const router = express.Router();

// EventSource cannot set Authorization headers, so the JWT arrives as ?token=.
router.get('/', async (req, res) => {
  let user;
  try {
    user = verifyToken(req.query.token || '');
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }
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
