const express = require('express');
const { requireAuth, requireAdmin } = require('../middleware/authMiddleware');
const db = require('../db');
const { logAction } = require('../services/auditService');

const router = express.Router();

// Recent commands for a server (admin view).
router.get('/:serverId', requireAuth, requireAdmin, async (req, res) => {
  const rows = await db.queryAll(
    `SELECT * FROM server_commands WHERE server_id = $1 ORDER BY created_at DESC LIMIT 50`,
    [req.params.serverId]
  );
  res.json(rows);
});

// Queue a one-shot command. Executed by the agent on its next check-in.
router.post('/', requireAuth, requireAdmin, async (req, res) => {
  const { server_id, ctype, param } = req.body;
  if (!server_id) return res.status(400).json({ error: 'server_id required' });
  if (!['reboot', 'restart_service', 'block_ip', 'uninstall_agent', 'force_update'].includes(ctype)) return res.status(400).json({ error: 'invalid ctype' });
  if (ctype === 'restart_service' && !param) return res.status(400).json({ error: 'service name required' });
  if (ctype === 'block_ip' && !param) return res.status(400).json({ error: 'ip required' });

  const server = await db.queryOne('SELECT hostname FROM servers WHERE id = $1', [server_id]);
  if (!server) return res.status(404).json({ error: 'server not found' });

  const r = await db.query(
    'INSERT INTO server_commands (server_id, ctype, param, requested_by) VALUES ($1, $2, $3, $4) RETURNING id',
    [server_id, ctype, param || '', req.user.email]
  );
  logAction({
    action_id: r.rows[0].id, server_id, hostname: server.hostname,
    label: ctype === 'reboot' ? 'reboot' : ctype === 'block_ip' ? `block IP ${param}` : ctype === 'uninstall_agent' ? 'uninstall agent' : ctype === 'force_update' ? 'force update' : `restart service ${param}`,
    new_state: 'QUEUED', source: 'web', actor: req.user.email,
  });
  res.json({ id: r.rows[0].id });
});

// Agent reports the outcome. Authenticated by the agent token, not a user JWT.
router.post('/:id/report', async (req, res) => {
  const { token, success, result } = req.body;
  if (!token) return res.status(401).json({ error: 'token required' });
  const agent = await db.queryOne('SELECT server_id FROM agent_tokens WHERE token = $1', [token]);
  if (!agent) return res.status(401).json({ error: 'invalid token' });
  await db.query(
    `UPDATE server_commands SET status = $1, result = $2, executed_at = NOW()
     WHERE id = $3 AND server_id = $4`,
    [success ? 'done' : 'failed', String(result || '').slice(0, 500), req.params.id, agent.server_id]
  );
  res.json({ success: true });
});

module.exports = router;
