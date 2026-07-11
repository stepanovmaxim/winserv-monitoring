const express = require('express');
const db = require('../db');

const router = express.Router();

// Public, unauthenticated per-customer status page. Intentionally minimal:
// exposes only service names and up/down state — no IPs, metrics, or internals.
// Guarded by an unguessable token; the customer must have it explicitly enabled.
router.get('/status/:token', async (req, res) => {
  const token = String(req.params.token || '');
  if (token.length < 16) return res.status(404).json({ error: 'not found' });

  const c = await db.queryOne(
    'SELECT id, name FROM customers WHERE status_token = $1 AND status_enabled = 1',
    [token]
  );
  if (!c) return res.status(404).json({ error: 'not found' });

  const servers = await db.queryAll(
    `SELECT hostname, status, last_seen FROM servers WHERE customer_id = $1 ORDER BY hostname`,
    [c.id]
  );
  const checks = await db.queryAll(
    `SELECT name, kind, status, last_checked FROM checks WHERE customer_id = $1 AND enabled = 1 ORDER BY name`,
    [c.id]
  );

  // Normalise everything to operational | degraded | down | unknown.
  const norm = (s) => {
    if (s === 'online' || s === 'up') return 'operational';
    if (s === 'warning') return 'degraded';
    if (s === 'offline' || s === 'down' || s === 'critical') return 'down';
    return 'unknown';
  };

  const components = [
    ...servers.map(s => ({ name: s.hostname, group: 'Servers', status: norm(s.status), updated: s.last_seen })),
    ...checks.map(ck => ({ name: ck.name, group: 'Services', status: norm(ck.status), updated: ck.last_checked })),
  ];

  const anyDown = components.some(x => x.status === 'down');
  const anyDegraded = components.some(x => x.status === 'degraded');
  const overall = components.length === 0 ? 'unknown' : anyDown ? 'down' : anyDegraded ? 'degraded' : 'operational';

  res.set('Cache-Control', 'no-store');
  res.json({ name: c.name, overall, components, generated_at: new Date().toISOString() });
});

module.exports = router;
