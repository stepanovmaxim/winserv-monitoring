const express = require('express');
const { requireAuth, requireAdmin, requireApproved } = require('../middleware/authMiddleware');
const db = require('../db');
const { v4: uuidv4 } = require('uuid');
const { customerFilter, canSeeServer, requireServerAccess } = require('../services/scopeService');

const router = express.Router();

router.get('/', requireAuth, requireApproved, async (req, res) => {
  const { group_id, customer_id } = req.query;
  let q = `
    SELECT s.*, g.name as group_name, c.name as customer_name,
      (SELECT COUNT(*)::int FROM health_items WHERE server_id = s.id) as health_issues,
      (SELECT cpu_usage FROM metrics WHERE server_id = s.id ORDER BY collected_at DESC LIMIT 1) as last_cpu,
      (SELECT memory_used_mb FROM metrics WHERE server_id = s.id ORDER BY collected_at DESC LIMIT 1) as last_mem_used,
      (SELECT memory_total_mb FROM metrics WHERE server_id = s.id ORDER BY collected_at DESC LIMIT 1) as last_mem_total,
      (SELECT disk_used_gb FROM metrics WHERE server_id = s.id ORDER BY collected_at DESC LIMIT 1) as last_disk_used,
      (SELECT disk_total_gb FROM metrics WHERE server_id = s.id ORDER BY collected_at DESC LIMIT 1) as last_disk_total,
      (SELECT disks_json FROM metrics WHERE server_id = s.id ORDER BY collected_at DESC LIMIT 1) as last_disks
    FROM servers s
    LEFT JOIN server_groups g ON s.group_id = g.id
    LEFT JOIN customers c ON s.customer_id = c.id
  `;
  const params = [];
  const where = [];

  if (group_id) { params.push(group_id); where.push(`s.group_id = $${params.length}`); }
  if (customer_id === 'none') { where.push('s.customer_id IS NULL'); }
  else if (customer_id) { params.push(customer_id); where.push(`s.customer_id = $${params.length}`); }

  // Restrict to the customers this user is assigned to (no assignment = all).
  const scoped = await customerFilter(req.user, 's.customer_id', params.length + 1);
  if (scoped.sql) {
    where.push(scoped.sql.replace(/^ AND /, ''));
    params.push(...scoped.params);
  }

  if (where.length) q += ' WHERE ' + where.join(' AND ');
  q += ' ORDER BY s.hostname';
  const servers = await db.queryAll(q, params);
  res.json(servers);
});

router.post('/', requireAuth, requireAdmin, async (req, res) => {
  const { hostname, display_name, ip_address, group_id, os_info } = req.body;
  if (!hostname) return res.status(400).json({ error: 'hostname is required' });

  const result = await db.query(
    'INSERT INTO servers (hostname, description, ip_address, group_id, os_info) VALUES ($1, $2, $3, $4, $5) RETURNING id',
    [hostname, req.body.description || '', ip_address || '', group_id || null, os_info || '']
  );

  const token = uuidv4();
  await db.query('INSERT INTO agent_tokens (server_id, token) VALUES ($1, $2)', [result.rows[0].id, token]);

  res.json({ id: result.rows[0].id, token });
});

router.put('/:id', requireAuth, requireAdmin, requireServerAccess('id'), async (req, res) => {
  const { hostname, description, ip_address, group_id, customer_id, os_info, notify_cpu, notify_memory, notify_disk, cpu_threshold, memory_threshold, disk_threshold } = req.body;
  const server = await db.queryOne('SELECT * FROM servers WHERE id = $1', [req.params.id]);
  if (!server) return res.status(404).json({ error: 'Server not found' });

  // A scoped admin must not be able to move a server out of (or into) their
  // scope — that would silently hand it to another tenant, or hide it entirely.
  if (customer_id !== undefined && Number(customer_id || 0) !== Number(server.customer_id || 0)) {
    const { canSeeCustomer } = require('../services/scopeService');
    const okFrom = await canSeeCustomer(req.user, server.customer_id);
    const okTo = await canSeeCustomer(req.user, customer_id || null);
    if (!okFrom || !okTo) return res.status(403).json({ error: 'No access to reassign this server' });
  }

  const toBool = (v, def) => v !== undefined ? (v ? 1 : 0) : def;
  // '' or null clears the override (inherit); undefined keeps the stored value.
  const toThresh = (v, def) => v === undefined ? def : (v === '' || v === null ? null : (parseInt(v) || null));

  await db.query(
    `UPDATE servers SET display_name = $1, ip_address = $2, group_id = $3, os_info = $4, description = $5,
       notify_cpu = $6, notify_memory = $7, notify_disk = $8, customer_id = $9,
       cpu_threshold = $10, memory_threshold = $11, disk_threshold = $12
     WHERE id = $13`,
    [
      // The panel's name field now sets the DISPLAY name and never touches
      // hostname. hostname is the identity the agent registers with: editing
      // it re-points or duplicates the record, which is exactly what happened
      // to AVTOSTEK HOST. Clearing the field falls back to showing hostname.
      display_name !== undefined ? (display_name || null)
        : (hostname !== undefined && hostname !== server.hostname ? (hostname || null) : (server.display_name || null)),
      ip_address !== undefined ? ip_address : server.ip_address,
      group_id !== undefined ? (group_id || null) : server.group_id,
      os_info !== undefined ? os_info : server.os_info,
      description !== undefined ? description : server.description,
      toBool(notify_cpu, server.notify_cpu),
      toBool(notify_memory, server.notify_memory),
      toBool(notify_disk, server.notify_disk),
      customer_id !== undefined ? (customer_id || null) : server.customer_id,
      toThresh(cpu_threshold, server.cpu_threshold),
      toThresh(memory_threshold, server.memory_threshold),
      toThresh(disk_threshold, server.disk_threshold),
      req.params.id
    ]
  );
  res.json({ success: true });
});

router.delete('/:id', requireAuth, requireAdmin, requireServerAccess('id'), async (req, res) => {
  await db.query('DELETE FROM servers WHERE id = $1', [req.params.id]);
  res.json({ success: true });
});

router.get('/:id', requireAuth, requireApproved, requireServerAccess('id'), async (req, res) => {
  const server = await db.queryOne(`
    SELECT s.*, g.name as group_name, c.name as customer_name
    FROM servers s
    LEFT JOIN server_groups g ON s.group_id = g.id
    LEFT JOIN customers c ON s.customer_id = c.id
    WHERE s.id = $1
  `, [req.params.id]);

  if (!server) return res.status(404).json({ error: 'Server not found' });
  res.json(server);
});

router.get('/:id/token', requireAuth, requireAdmin, requireServerAccess('id'), async (req, res) => {
  const token = await db.queryOne('SELECT * FROM agent_tokens WHERE server_id = $1', [req.params.id]);
  if (!token) return res.status(404).json({ error: 'No token found' });
  res.json({ token: token.token });
});

router.post('/:id/regenerate-token', requireAuth, requireAdmin, requireServerAccess('id'), async (req, res) => {
  await db.query('DELETE FROM agent_tokens WHERE server_id = $1', [req.params.id]);
  const token = uuidv4();
  await db.query('INSERT INTO agent_tokens (server_id, token) VALUES ($1, $2)', [req.params.id, token]);
  res.json({ token });
});

module.exports = router;
