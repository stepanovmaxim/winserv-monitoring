const express = require('express');
const db = require('../db');
const { v4: uuidv4 } = require('uuid');
const { checkAlerts } = require('../services/alertService');

const REGISTRATION_KEY = process.env.REGISTRATION_KEY || 'winserv-reg-key-change-me';
const router = express.Router();

router.post('/', async (req, res) => {
  const { token, registration_key, hostname, ip_address, os_info, metrics: metricsData } = req.body;
  const h = hostname || req.body.host || '';

  let serverId = null;

  if (token) {
    const agentRecord = await db.queryOne('SELECT * FROM agent_tokens WHERE token = $1', [token]);
    if (agentRecord) {
      serverId = agentRecord.server_id;
    }
  }

  if (!serverId && registration_key === REGISTRATION_KEY && h) {
    let server = await db.queryOne('SELECT * FROM servers WHERE hostname = $1', [h]);
    if (!server) {
      const result = await db.query(
        'INSERT INTO servers (hostname, ip_address, os_info, status) VALUES ($1, $2, $3, $4) RETURNING id',
        [h, ip_address || '', os_info || '', 'online']
      );
      server = { id: result.rows[0].id };
    } else {
      serverId = server.id;
    }

    if (!serverId) {
      serverId = server.id;
      const newToken = uuidv4();
      await db.query(
        'INSERT INTO agent_tokens (server_id, token) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [serverId, newToken]
      );
      const tokenRecord = await db.queryOne('SELECT token FROM agent_tokens WHERE server_id = $1', [serverId]);
      if (!tokenRecord) {
        await db.query('INSERT INTO agent_tokens (server_id, token) VALUES ($1, $2)', [serverId, newToken]);
      }
    }
  }

  if (!serverId) {
    return res.status(401).json({ error: 'Valid token or registration_key required' });
  }

  const server = await db.queryOne('SELECT * FROM servers WHERE id = $1', [serverId]);

  if (h && server.hostname !== h) {
    await db.query('UPDATE servers SET hostname = $1 WHERE id = $2', [h, serverId]);
  }
  if (ip_address) {
    await db.query('UPDATE servers SET ip_address = $1 WHERE id = $2', [ip_address, serverId]);
  }
  if (os_info) {
    await db.query('UPDATE servers SET os_info = $1 WHERE id = $2', [os_info, serverId]);
  }

  if (metricsData) {
    let cpu_usage = null, memory_total_mb = null, memory_used_mb = null;
    let disk_total_gb = null, disk_used_gb = null, disk_free_gb = null, uptime_seconds = null;

    if (typeof metricsData === 'string') {
      try { metricsData = JSON.parse(metricsData); } catch {}
    }
    if (typeof metricsData === 'object') {
      cpu_usage = metricsData.cpu_usage;
      memory_total_mb = metricsData.memory_total_mb;
      memory_used_mb = metricsData.memory_used_mb;
      disk_total_gb = metricsData.disk_total_gb;
      disk_used_gb = metricsData.disk_used_gb;
      disk_free_gb = metricsData.disk_free_gb;
      uptime_seconds = metricsData.uptime_seconds;
    }

    await db.query(
      `INSERT INTO metrics (server_id, cpu_usage, memory_total_mb, memory_used_mb, disk_total_gb, disk_used_gb, disk_free_gb, uptime_seconds)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [serverId, cpu_usage, memory_total_mb, memory_used_mb, disk_total_gb, disk_used_gb, disk_free_gb, uptime_seconds]
    );

    checkAlerts(serverId, { cpu_usage, memory_total_mb, memory_used_mb, disk_total_gb, disk_used_gb, disk_free_gb });
  }

  await db.query("UPDATE servers SET last_seen = NOW(), status = 'online' WHERE id = $1", [serverId]);

  const agentToken = await db.queryOne('SELECT token FROM agent_tokens WHERE server_id = $1', [serverId]);
  res.json({ success: true, server_id: serverId, token: agentToken?.token || null });
});

router.get('/:serverId', async (req, res) => {
  const { serverId } = req.params;
  const { hours } = req.query;
  const lookback = hours || 24;

  const metrics = await db.queryAll(
    `SELECT * FROM metrics WHERE server_id = $1 AND collected_at >= NOW() - ($2 || ' hours')::INTERVAL ORDER BY collected_at ASC`,
    [serverId, String(lookback)]
  );

  res.json(metrics);
});

module.exports = router;
