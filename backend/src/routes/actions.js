const express = require('express');
const { requireAuth, requireAdmin } = require('../middleware/authMiddleware');
const db = require('../db');
const { logAction } = require('../services/auditService');

const router = express.Router();

router.get('/', requireAuth, requireAdmin, async (req, res) => {
  const actions = await db.queryAll(
    `SELECT sa.*, s.hostname
     FROM server_actions sa
     JOIN servers s ON s.id = sa.server_id
     ORDER BY s.hostname`
  );
  res.json(actions);
});

router.get('/audit', requireAuth, requireAdmin, async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 100, 500);
  const rows = await db.queryAll(
    'SELECT * FROM action_audit ORDER BY created_at DESC LIMIT $1',
    [limit]
  );
  res.json(rows);
});

router.post('/', requireAuth, requireAdmin, async (req, res) => {
  const { server_id, label, file_path, logout_users, allowed_chats, schedule_enabled, schedule_hide, schedule_show } = req.body;
  if (!server_id) return res.status(400).json({ error: 'server_id required' });
  if (!file_path) return res.status(400).json({ error: 'file_path required' });

  const result = await db.query(
    `INSERT INTO server_actions (server_id, label, file_path, logout_users, allowed_chats, schedule_enabled, schedule_hide, schedule_show)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [server_id, label || '', file_path, logout_users !== false ? 1 : 0, allowed_chats || '',
     schedule_enabled ? 1 : 0, schedule_hide || '', schedule_show || '']
  );
  res.json({ id: result.rows[0].id });
});

// Bulk hide/show across a group, a customer, or the whole fleet.
router.post('/bulk', requireAuth, requireAdmin, async (req, res) => {
  const { scope, scope_id, action } = req.body;
  if (!['group', 'customer', 'all'].includes(scope)) return res.status(400).json({ error: 'invalid scope' });
  if (!['hide', 'show'].includes(action)) return res.status(400).json({ error: 'invalid action' });
  const newState = action === 'hide' ? 1 : 0;
  const params = [newState];
  let filter = '';
  if (scope === 'group') { params.push(scope_id); filter = 'AND s.group_id = $2'; }
  else if (scope === 'customer') { params.push(scope_id); filter = 'AND s.customer_id = $2'; }

  const rows = await db.queryAll(
    `UPDATE server_actions sa SET enabled = $1, applied = 0
     FROM servers s WHERE sa.server_id = s.id ${filter}
     RETURNING sa.id, sa.server_id, sa.label, s.hostname`,
    params
  );
  for (const a of rows) {
    logAction({ action_id: a.id, server_id: a.server_id, hostname: a.hostname, label: a.label, new_state: newState ? 'HIDDEN' : 'VISIBLE', source: 'web-bulk', actor: req.user.email });
  }
  res.json({ success: true, affected: rows.length });
});

router.put('/:id', requireAuth, requireAdmin, async (req, res) => {
  const { label, file_path, logout_users, allowed_chats, schedule_enabled, schedule_hide, schedule_show } = req.body;
  const a = await db.queryOne('SELECT * FROM server_actions WHERE id = $1', [req.params.id]);
  if (!a) return res.sendStatus(404);

  await db.query(
    `UPDATE server_actions SET label = $1, file_path = $2, logout_users = $3, allowed_chats = $4,
       schedule_enabled = $5, schedule_hide = $6, schedule_show = $7 WHERE id = $8`,
    [label !== undefined ? label : a.label, file_path || a.file_path,
     logout_users !== undefined ? (logout_users ? 1 : 0) : a.logout_users,
     allowed_chats !== undefined ? allowed_chats : a.allowed_chats,
     schedule_enabled !== undefined ? (schedule_enabled ? 1 : 0) : a.schedule_enabled,
     schedule_hide !== undefined ? schedule_hide : a.schedule_hide,
     schedule_show !== undefined ? schedule_show : a.schedule_show,
     req.params.id]
  );
  res.json({ success: true });
});

router.delete('/:id', requireAuth, requireAdmin, async (req, res) => {
  await db.query('DELETE FROM server_actions WHERE id = $1', [req.params.id]);
  res.json({ success: true });
});

router.post('/:id/toggle', requireAuth, requireAdmin, async (req, res) => {
  const a = await db.queryOne(
    'SELECT sa.*, s.hostname FROM server_actions sa JOIN servers s ON s.id = sa.server_id WHERE sa.id = $1',
    [req.params.id]
  );
  if (!a) return res.sendStatus(404);
  const newState = a.enabled ? 0 : 1;
  await db.query('UPDATE server_actions SET enabled = $1, applied = 0 WHERE id = $2', [newState, req.params.id]);
  logAction({
    action_id: a.id, server_id: a.server_id, hostname: a.hostname, label: a.label,
    new_state: newState ? 'HIDDEN' : 'VISIBLE', source: 'web', actor: req.user.email,
  });
  res.json({ enabled: !!newState });
});

router.post('/:id/report', async (req, res) => {
  const { token, success } = req.body;
  if (!token) return res.status(401).json({ error: 'Token required' });
  const agent = await db.queryOne('SELECT * FROM agent_tokens WHERE token = $1', [token]);
  if (!agent) return res.status(401).json({ error: 'Invalid token' });
  await db.query(
    'UPDATE server_actions SET applied = 1 WHERE id = $1 AND server_id = $2',
    [req.params.id, agent.server_id]
  );
  res.json({ success: true });
});

module.exports = router;
