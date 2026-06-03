const express = require('express');
const { requireAuth, requireAdmin } = require('../middleware/authMiddleware');
const db = require('../db');

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

router.post('/', requireAuth, requireAdmin, async (req, res) => {
  const { server_id, label, file_path, logout_users } = req.body;
  if (!server_id) return res.status(400).json({ error: 'server_id required' });
  if (!file_path) return res.status(400).json({ error: 'file_path required' });

  const result = await db.query(
    'INSERT INTO server_actions (server_id, label, file_path, logout_users) VALUES ($1, $2, $3, $4) RETURNING id',
    [server_id, label || '', file_path, logout_users !== false ? 1 : 0]
  );
  res.json({ id: result.rows[0].id });
});

router.put('/:id', requireAuth, requireAdmin, async (req, res) => {
  const { label, file_path, logout_users } = req.body;
  const a = await db.queryOne('SELECT * FROM server_actions WHERE id = $1', [req.params.id]);
  if (!a) return res.status(404);

  await db.query(
    'UPDATE server_actions SET label = $1, file_path = $2, logout_users = $3 WHERE id = $4',
    [label !== undefined ? label : a.label, file_path || a.file_path, logout_users !== undefined ? (logout_users ? 1 : 0) : a.logout_users, req.params.id]
  );
  res.json({ success: true });
});

router.delete('/:id', requireAuth, requireAdmin, async (req, res) => {
  await db.query('DELETE FROM server_actions WHERE id = $1', [req.params.id]);
  res.json({ success: true });
});

router.post('/:id/toggle', requireAuth, requireAdmin, async (req, res) => {
  const a = await db.queryOne('SELECT * FROM server_actions WHERE id = $1', [req.params.id]);
  if (!a) return res.status(404);
  const newState = a.enabled ? 0 : 1;
  await db.query('UPDATE server_actions SET enabled = $1 WHERE id = $2', [newState, req.params.id]);
  res.json({ enabled: !!newState });
});

router.post('/:id/report', async (req, res) => {
  const { token, success } = req.body;
  if (!token) return res.status(401).json({ error: 'Token required' });
  const agent = await db.queryOne('SELECT * FROM agent_tokens WHERE token = $1', [token]);
  if (!agent) return res.status(401).json({ error: 'Invalid token' });
  await db.query(
    'UPDATE server_actions SET enabled = CASE WHEN enabled = 1 THEN 0 ELSE 1 END WHERE id = $1 AND server_id = $2',
    [req.params.id, agent.server_id]
  );
  res.json({ success: true });
});

module.exports = router;
