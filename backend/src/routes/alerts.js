const express = require('express');
const { requireAuth, requireAdmin, requireApproved } = require('../middleware/authMiddleware');
const db = require('../db');

const router = express.Router();

// Alert journal, newest first. Filters: ?ack=0|1, ?severity=, ?kind=, ?limit=.
router.get('/', requireAuth, requireApproved, async (req, res) => {
  const where = [];
  const params = [];
  if (req.query.ack === '0') where.push('a.acknowledged_at IS NULL');
  else if (req.query.ack === '1') where.push('a.acknowledged_at IS NOT NULL');
  if (req.query.severity) { params.push(req.query.severity); where.push(`a.severity = $${params.length}`); }
  if (req.query.kind) { params.push(req.query.kind); where.push(`a.kind = $${params.length}`); }
  const limit = Math.min(parseInt(req.query.limit) || 200, 500);
  const rows = await db.queryAll(
    `SELECT a.*, s.hostname, cu.name AS customer_name, ck.name AS check_name
     FROM alerts a
     LEFT JOIN servers s ON s.id = a.server_id
     LEFT JOIN customers cu ON cu.id = a.customer_id
     LEFT JOIN checks ck ON ck.id = a.check_id
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY a.created_at DESC LIMIT ${limit}`,
    params
  );
  res.json(rows);
});

// Unacknowledged count, for the nav badge.
router.get('/unacked-count', requireAuth, requireApproved, async (req, res) => {
  const r = await db.queryOne('SELECT COUNT(*)::int AS n FROM alerts WHERE acknowledged_at IS NULL');
  res.json({ count: r ? r.n : 0 });
});

router.post('/:id/ack', requireAuth, requireApproved, async (req, res) => {
  await db.query(
    `UPDATE alerts SET acknowledged_at = NOW(), acknowledged_by = $1 WHERE id = $2 AND acknowledged_at IS NULL`,
    [req.user.email || req.user.name || '', req.params.id]
  );
  res.json({ success: true });
});

// Acknowledge every currently-unacknowledged alert.
router.post('/ack-all', requireAuth, requireApproved, async (req, res) => {
  const r = await db.query(
    `UPDATE alerts SET acknowledged_at = NOW(), acknowledged_by = $1 WHERE acknowledged_at IS NULL`,
    [req.user.email || req.user.name || '']
  );
  res.json({ success: true, count: r.rowCount });
});

// Snooze: acknowledge this alert AND mute its source for N minutes by opening a
// maintenance window (server-scoped, else customer-scoped). Reuses the existing
// mute infrastructure so all alerting paths honour it immediately.
router.post('/:id/snooze', requireAuth, requireAdmin, async (req, res) => {
  const mins = Math.min(Math.max(parseInt(req.body.minutes) || 60, 5), 7 * 24 * 60);
  const a = await db.queryOne('SELECT * FROM alerts WHERE id = $1', [req.params.id]);
  if (!a) return res.status(404).json({ error: 'not found' });

  let scope_type = null, scope_id = null;
  if (a.server_id) { scope_type = 'server'; scope_id = a.server_id; }
  else if (a.customer_id) { scope_type = 'customer'; scope_id = a.customer_id; }
  if (!scope_type) return res.status(400).json({ error: 'alert has no server or customer to snooze' });

  await db.query(
    `INSERT INTO maintenance_windows (scope_type, scope_id, starts_at, ends_at, reason, created_by)
     VALUES ($1, $2, NOW(), NOW() + ($3 || ' minutes')::INTERVAL, $4, $5)`,
    [scope_type, scope_id, String(mins), `Snoozed from alert #${a.id}`, req.user.email || '']
  );
  await db.query('UPDATE alerts SET acknowledged_at = NOW(), acknowledged_by = $1 WHERE id = $2', [req.user.email || '', a.id]);
  res.json({ success: true, minutes: mins });
});

module.exports = router;
