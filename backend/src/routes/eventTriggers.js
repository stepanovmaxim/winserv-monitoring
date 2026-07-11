const express = require('express');
const { requireAuth, requireAdmin, requireApproved } = require('../middleware/authMiddleware');
const db = require('../db');

const router = express.Router();

router.get('/', requireAuth, requireApproved, async (req, res) => {
  const rows = await db.queryAll('SELECT * FROM event_triggers ORDER BY event_id');
  res.json(rows);
});

router.post('/', requireAuth, requireAdmin, async (req, res) => {
  const { event_id, log_name, source_match, label, severity } = req.body;
  const eid = parseInt(event_id);
  if (!Number.isFinite(eid)) return res.status(400).json({ error: 'valid event_id required' });
  const sev = ['info', 'warning', 'critical'].includes(severity) ? severity : 'warning';
  const r = await db.query(
    `INSERT INTO event_triggers (event_id, log_name, source_match, label, severity)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [eid, (log_name || 'System').slice(0, 60), (source_match || '').slice(0, 120), (label || '').slice(0, 120), sev]
  );
  res.json({ id: r.rows[0].id });
});

router.put('/:id', requireAuth, requireAdmin, async (req, res) => {
  const t = await db.queryOne('SELECT * FROM event_triggers WHERE id = $1', [req.params.id]);
  if (!t) return res.status(404).json({ error: 'not found' });
  const { event_id, log_name, source_match, label, severity, enabled } = req.body;
  await db.query(
    `UPDATE event_triggers SET event_id=$1, log_name=$2, source_match=$3, label=$4, severity=$5, enabled=$6 WHERE id=$7`,
    [
      event_id !== undefined ? (parseInt(event_id) || t.event_id) : t.event_id,
      log_name !== undefined ? String(log_name).slice(0, 60) : t.log_name,
      source_match !== undefined ? String(source_match).slice(0, 120) : t.source_match,
      label !== undefined ? String(label).slice(0, 120) : t.label,
      (severity && ['info', 'warning', 'critical'].includes(severity)) ? severity : t.severity,
      enabled !== undefined ? (enabled ? 1 : 0) : t.enabled,
      req.params.id,
    ]
  );
  res.json({ success: true });
});

router.delete('/:id', requireAuth, requireAdmin, async (req, res) => {
  await db.query('DELETE FROM event_triggers WHERE id = $1', [req.params.id]);
  res.json({ success: true });
});

module.exports = router;
