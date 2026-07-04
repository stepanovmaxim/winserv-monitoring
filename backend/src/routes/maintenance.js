const express = require('express');
const { requireAuth, requireAdmin, requireApproved } = require('../middleware/authMiddleware');
const db = require('../db');

const router = express.Router();

// Active + upcoming + recently-ended windows, with a human-readable scope label.
router.get('/', requireAuth, requireApproved, async (req, res) => {
  const rows = await db.queryAll(
    `SELECT mw.*,
       CASE mw.scope_type
         WHEN 'server'   THEN (SELECT hostname FROM servers WHERE id = mw.scope_id)
         WHEN 'group'    THEN (SELECT name FROM server_groups WHERE id = mw.scope_id)
         WHEN 'customer' THEN (SELECT name FROM customers WHERE id = mw.scope_id)
         ELSE 'ALL SERVERS'
       END AS scope_name,
       (NOW() BETWEEN mw.starts_at AND mw.ends_at) AS active
     FROM maintenance_windows mw
     WHERE mw.ends_at > NOW() - INTERVAL '1 day'
     ORDER BY mw.starts_at DESC`
  );
  res.json(rows);
});

router.post('/', requireAuth, requireAdmin, async (req, res) => {
  const { scope_type, scope_id, reason } = req.body;
  let { starts_at, ends_at } = req.body;
  const validScopes = ['global', 'customer', 'group', 'server'];
  if (!validScopes.includes(scope_type)) return res.status(400).json({ error: 'invalid scope_type' });
  if (scope_type !== 'global' && !scope_id) return res.status(400).json({ error: 'scope_id required' });

  // Quick-mute convenience: no explicit window → start now for duration_minutes.
  if (!starts_at && req.body.duration_minutes) {
    const mins = parseInt(req.body.duration_minutes) || 60;
    const r = await db.query(
      `INSERT INTO maintenance_windows (scope_type, scope_id, starts_at, ends_at, reason, created_by)
       VALUES ($1, $2, NOW(), NOW() + ($3 || ' minutes')::INTERVAL, $4, $5) RETURNING id`,
      [scope_type, scope_type === 'global' ? null : scope_id, String(mins), reason || '', req.user.email]
    );
    return res.json({ id: r.rows[0].id });
  }

  if (!starts_at || !ends_at) return res.status(400).json({ error: 'starts_at and ends_at (or duration_minutes) required' });
  const r = await db.query(
    `INSERT INTO maintenance_windows (scope_type, scope_id, starts_at, ends_at, reason, created_by)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [scope_type, scope_type === 'global' ? null : scope_id, starts_at, ends_at, reason || '', req.user.email]
  );
  res.json({ id: r.rows[0].id });
});

router.delete('/:id', requireAuth, requireAdmin, async (req, res) => {
  await db.query('DELETE FROM maintenance_windows WHERE id = $1', [req.params.id]);
  res.json({ success: true });
});

module.exports = router;
