const db = require('../db');
const { sendTelegramMessage } = require('./telegram');

async function checkAlerts(serverId, metrics) {
  const config = await db.queryOne('SELECT * FROM telegram_config WHERE enabled = 1 LIMIT 1');
  if (!config) return;

  const server = await db.queryOne('SELECT * FROM servers WHERE id = $1', [serverId]);
  if (!server) return;

  const alerts = [];

  if (config.notify_cpu && metrics.cpu_usage != null && Number(metrics.cpu_usage) > 90) {
    alerts.push(`<b>High CPU</b> on ${server.hostname}: ${Number(metrics.cpu_usage).toFixed(1)}%`);
  }

  if (config.notify_disk && metrics.disk_total_gb > 0) {
    const diskPercent = (Number(metrics.disk_used_gb) / Number(metrics.disk_total_gb)) * 100;
    if (diskPercent > 90) {
      alerts.push(`<b>Low disk</b> on ${server.hostname}: ${Number(metrics.disk_free_gb).toFixed(1)} GB free (${diskPercent.toFixed(1)}% used)`);
    }
  }

  if (config.notify_errors) {
    const memPercent = Number(metrics.memory_total_mb) > 0
      ? (Number(metrics.memory_used_mb) / Number(metrics.memory_total_mb)) * 100 : 0;
    if (memPercent > 95) {
      alerts.push(`<b>High memory</b> on ${server.hostname}: ${memPercent.toFixed(1)}%`);
    }
  }

  if (alerts.length > 0) {
    sendTelegramMessage(alerts.join('\n')).catch(err => console.error('[Alert]', err.message));
  }
}

async function checkOfflineServers() {
  try {
    const config = await db.queryOne('SELECT * FROM telegram_config WHERE enabled = 1 LIMIT 1');

    const justOffline = await db.queryAll(
      `UPDATE servers SET status = 'offline'
       WHERE status = 'online' AND (last_seen IS NULL OR last_seen < NOW() - INTERVAL '2 minutes')
       RETURNING hostname`
    );

    if (config && config.notify_offline) {
      for (const s of justOffline) {
        sendTelegramMessage(`<b>OFFLINE</b>: ${s.hostname} — no contact for 2+ minutes`).catch(() => {});
      }
    }

    const justOnline = await db.queryAll(
      `UPDATE servers SET status = 'online'
       WHERE status = 'offline' AND last_seen > NOW() - INTERVAL '1 minute'
       RETURNING hostname`
    );

    if (config && config.notify_offline) {
      for (const s of justOnline) {
        sendTelegramMessage(`<b>ONLINE</b>: ${s.hostname} is back`).catch(() => {});
      }
    }
  } catch (err) {
    console.error('[Offline check]', err.message);
  }
}

module.exports = { checkAlerts, checkOfflineServers };
