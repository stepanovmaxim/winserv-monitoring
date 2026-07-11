const express = require('express');
const { requireAuth, requireAdmin, requireApproved } = require('../middleware/authMiddleware');
const db = require('../db');
const { runCheck } = require('../services/checkService');

const router = express.Router();
const KINDS = ['ping', 'tcp', 'http', 'tls'];

router.get('/', requireAuth, requireApproved, async (req, res) => {
  const rows = await db.queryAll(
    `SELECT c.*, cu.name AS customer_name
     FROM checks c LEFT JOIN customers cu ON cu.id = c.customer_id
     ORDER BY (c.status = 'down') DESC, c.name`
  );
  res.json(rows);
});

router.post('/', requireAuth, requireAdmin, async (req, res) => {
  const { name, customer_id, kind, host, port, target, interval_sec } = req.body;
  if (!name || !host) return res.status(400).json({ error: 'name and host required' });
  if (!KINDS.includes(kind)) return res.status(400).json({ error: 'invalid kind' });
  if (kind === 'tcp' && !port) return res.status(400).json({ error: 'port required for tcp' });
  const r = await db.query(
    `INSERT INTO checks (name, customer_id, kind, host, port, target, interval_sec)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [name, customer_id || null, kind, host, port || null, target || '', Math.max(20, parseInt(interval_sec) || 60)]
  );
  res.json({ id: r.rows[0].id });
});

router.put('/:id', requireAuth, requireAdmin, async (req, res) => {
  const c = await db.queryOne('SELECT * FROM checks WHERE id = $1', [req.params.id]);
  if (!c) return res.status(404).json({ error: 'not found' });
  const { name, customer_id, kind, host, port, target, interval_sec, enabled } = req.body;
  await db.query(
    `UPDATE checks SET name=$1, customer_id=$2, kind=$3, host=$4, port=$5, target=$6, interval_sec=$7, enabled=$8 WHERE id=$9`,
    [
      name || c.name,
      customer_id !== undefined ? (customer_id || null) : c.customer_id,
      kind && KINDS.includes(kind) ? kind : c.kind,
      host || c.host,
      port !== undefined ? (port || null) : c.port,
      target !== undefined ? target : c.target,
      interval_sec !== undefined ? Math.max(20, parseInt(interval_sec) || 60) : c.interval_sec,
      enabled !== undefined ? (enabled ? 1 : 0) : c.enabled,
      req.params.id,
    ]
  );
  res.json({ success: true });
});

router.delete('/:id', requireAuth, requireAdmin, async (req, res) => {
  await db.query('DELETE FROM checks WHERE id = $1', [req.params.id]);
  res.json({ success: true });
});

// Run a check immediately and store the result.
router.post('/:id/run', requireAuth, requireAdmin, async (req, res) => {
  const c = await db.queryOne('SELECT * FROM checks WHERE id = $1', [req.params.id]);
  if (!c) return res.status(404).json({ error: 'not found' });
  const r = await runCheck(c);
  await db.query('UPDATE checks SET status=$1, last_latency_ms=$2, last_checked=NOW(), last_error=$3 WHERE id=$4',
    [r.status, r.latency, String(r.error || '').slice(0, 200), c.id]);
  res.json(r);
});

router.get('/:id/history', requireAuth, requireApproved, async (req, res) => {
  const rows = await db.queryAll(
    'SELECT * FROM check_events WHERE check_id = $1 ORDER BY at DESC LIMIT 100',
    [req.params.id]
  );
  res.json(rows);
});

module.exports = router;
