const db = require('../db');
const { sendTelegramMessage } = require('./telegram');

async function checkAlerts(serverId, metrics) {
  const config = await db.queryOne('SELECT * FROM telegram_config WHERE enabled = 1 LIMIT 1');
  if (!config) return;

  const server = await db.queryOne('SELECT * FROM servers WHERE id = $1', [serverId]);
  if (!server) return;

  const alerts = [];

  if (config.notify_cpu && metrics.cpu_usage > 90) {
    alerts.push(`High CPU on <b>${server.hostname}</b>: ${Number(metrics.cpu_usage).toFixed(1)}%`);
  }

  if (config.notify_disk && metrics.disk_total_gb > 0) {
    const diskPercent = (metrics.disk_used_gb / metrics.disk_total_gb) * 100;
    if (diskPercent > 90) {
      alerts.push(`Low disk on <b>${server.hostname}</b>: ${Number(metrics.disk_free_gb).toFixed(1)} GB free (${Number(diskPercent).toFixed(1)}% used)`);
    }
  }

  if (metrics.memory_total_mb > 0) {
    const memPercent = (metrics.memory_used_mb / metrics.memory_total_mb) * 100;
    if (memPercent > 95) {
      alerts.push(`High memory on <b>${server.hostname}</b>: ${Number(memPercent).toFixed(1)}%`);
    }
  }

  if (alerts.length > 0) {
    sendTelegramMessage(alerts.join('\n')).catch(() => {});
  }
}

module.exports = { checkAlerts };
