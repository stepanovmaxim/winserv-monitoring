const express = require('express');
const { requireAuth, requireAdmin, requireApproved } = require('../middleware/authMiddleware');
const db = require('../db');
const { requireUnrestricted } = require('../services/scopeService');

const router = express.Router();

router.get('/', requireAuth, requireApproved, async (req, res) => {
  const rows = await db.queryAll('SELECT * FROM event_triggers ORDER BY event_id');
  res.json(rows);
});

// Curated security triggers. These are the events that matter after a breach:
// log wiping (an attacker covering tracks), new accounts and privilege grants,
// and persistence via services or scheduled tasks.
// NOTE: the 4xxx ones live in the Security log and only appear if the matching
// audit policy is switched on — that is stated in the UI.
const SECURITY_PRESET = [
  { event_id: 1102, log_name: 'Security', label: 'Security audit log cleared', severity: 'critical' },
  { event_id: 104,  log_name: 'System',   label: 'Event log cleared', severity: 'critical' },
  { event_id: 4720, log_name: 'Security', label: 'Local user account created', severity: 'warning' },
  { event_id: 4732, log_name: 'Security', label: 'Member added to a local group (e.g. Administrators)', severity: 'warning' },
  { event_id: 4728, log_name: 'Security', label: 'Member added to a global group', severity: 'warning' },
  { event_id: 7045, log_name: 'System',   label: 'New service installed', severity: 'warning' },
  { event_id: 4698, log_name: 'Security', label: 'Scheduled task created', severity: 'warning' },
  { event_id: 4740, log_name: 'Security', label: 'Account locked out', severity: 'info' },
];

router.get('/preset', requireAuth, requireApproved, (req, res) => res.json(SECURITY_PRESET));

// Add every preset entry that isn't configured yet (existing ones are untouched).
router.post('/preset', requireAuth, requireAdmin, requireUnrestricted, async (req, res) => {
  let added = 0;
  for (const t of SECURITY_PRESET) {
    const exists = await db.queryOne('SELECT id FROM event_triggers WHERE event_id = $1 AND log_name = $2', [t.event_id, t.log_name]);
    if (exists) continue;
    await db.query(
      'INSERT INTO event_triggers (event_id, log_name, source_match, label, severity) VALUES ($1,$2,$3,$4,$5)',
      [t.event_id, t.log_name, '', t.label, t.severity]
    );
    added++;
  }
  res.json({ success: true, added, total: SECURITY_PRESET.length });
});

router.post('/', requireAuth, requireAdmin, requireUnrestricted, async (req, res) => {
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

router.put('/:id', requireAuth, requireAdmin, requireUnrestricted, async (req, res) => {
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

router.delete('/:id', requireAuth, requireAdmin, requireUnrestricted, async (req, res) => {
  await db.query('DELETE FROM event_triggers WHERE id = $1', [req.params.id]);
  res.json({ success: true });
});

module.exports = router;
