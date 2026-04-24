const express = require('express');
const { requireAuth, requireAdmin, requireApproved } = require('../middleware/authMiddleware');
const db = require('../db');
const { v4: uuidv4 } = require('uuid');

const router = express.Router();

router.get('/', requireAuth, requireApproved, async (req, res) => {
  const { group_id } = req.query;
  let q = `
    SELECT s.*, g.name as group_name,
      (SELECT cpu_usage FROM metrics WHERE server_id = s.id ORDER BY collected_at DESC LIMIT 1) as last_cpu,
      (SELECT memory_used_mb FROM metrics WHERE server_id = s.id ORDER BY collected_at DESC LIMIT 1) as last_mem_used,
      (SELECT memory_total_mb FROM metrics WHERE server_id = s.id ORDER BY collected_at DESC LIMIT 1) as last_mem_total,
      (SELECT disk_used_gb FROM metrics WHERE server_id = s.id ORDER BY collected_at DESC LIMIT 1) as last_disk_used,
      (SELECT disk_total_gb FROM metrics WHERE server_id = s.id ORDER BY collected_at DESC LIMIT 1) as last_disk_total
    FROM servers s
    LEFT JOIN server_groups g ON s.group_id = g.id
  `;
  const params = [];

  if (group_id) {
    q += ' WHERE s.group_id = $1';
    params.push(group_id);
  }

  q += ' ORDER BY s.hostname';
  const servers = await db.queryAll(q, params);
  res.json(servers);
});

router.post('/', requireAuth, requireAdmin, async (req, res) => {
  const { hostname, ip_address, group_id, os_info } = req.body;
  if (!hostname) return res.status(400).json({ error: 'hostname is required' });

  const result = await db.query(
    'INSERT INTO servers (hostname, ip_address, group_id, os_info) VALUES ($1, $2, $3, $4) RETURNING id',
    [hostname, ip_address || '', group_id || null, os_info || '']
  );

  const token = uuidv4();
  await db.query('INSERT INTO agent_tokens (server_id, token) VALUES ($1, $2)', [result.rows[0].id, token]);

  res.json({ id: result.rows[0].id, token });
});

router.put('/:id', requireAuth, requireAdmin, async (req, res) => {
  const { hostname, ip_address, group_id, os_info } = req.body;
  const server = await db.queryOne('SELECT * FROM servers WHERE id = $1', [req.params.id]);
  if (!server) return res.status(404).json({ error: 'Server not found' });

  await db.query(
    'UPDATE servers SET hostname = $1, ip_address = $2, group_id = $3, os_info = $4 WHERE id = $5',
    [
      hostname || server.hostname,
      ip_address !== undefined ? ip_address : server.ip_address,
      group_id !== undefined ? (group_id || null) : server.group_id,
      os_info !== undefined ? os_info : server.os_info,
      req.params.id
    ]
  );
  res.json({ success: true });
});

router.delete('/:id', requireAuth, requireAdmin, async (req, res) => {
  await db.query('DELETE FROM servers WHERE id = $1', [req.params.id]);
  res.json({ success: true });
});

router.get('/:id', requireAuth, requireApproved, async (req, res) => {
  const server = await db.queryOne(`
    SELECT s.*, g.name as group_name
    FROM servers s
    LEFT JOIN server_groups g ON s.group_id = g.id
    WHERE s.id = $1
  `, [req.params.id]);

  if (!server) return res.status(404).json({ error: 'Server not found' });
  res.json(server);
});

router.get('/:id/token', requireAuth, requireAdmin, async (req, res) => {
  const token = await db.queryOne('SELECT * FROM agent_tokens WHERE server_id = $1', [req.params.id]);
  if (!token) return res.status(404).json({ error: 'No token found' });
  res.json({ token: token.token });
});

router.post('/:id/regenerate-token', requireAuth, requireAdmin, async (req, res) => {
  await db.query('DELETE FROM agent_tokens WHERE server_id = $1', [req.params.id]);
  const token = uuidv4();
  await db.query('INSERT INTO agent_tokens (server_id, token) VALUES ($1, $2)', [req.params.id, token]);
  res.json({ token });
});

module.exports = router;
