const express = require('express');
const db = require('../db');
const { checkAlerts } = require('../services/alertService');

const router = express.Router();

router.post('/', async (req, res) => {
  const { token, hostname, ip_address, os_info, metrics: metricsData } = req.body;

  if (!token) return res.status(401).json({ error: 'Agent token required' });

  const agentRecord = await db.queryOne('SELECT * FROM agent_tokens WHERE token = $1', [token]);
  if (!agentRecord) return res.status(401).json({ error: 'Invalid agent token' });

  let serverId = agentRecord.server_id;
  const server = await db.queryOne('SELECT * FROM servers WHERE id = $1', [serverId]);

  if (hostname && server.hostname !== hostname) {
    await db.query('UPDATE servers SET hostname = $1 WHERE id = $2', [hostname, serverId]);
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

  res.json({ success: true });
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
