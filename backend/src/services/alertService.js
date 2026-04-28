const db = require('../db');
const { sendTelegramMessage } = require('./telegram');

const alertActive = new Map();

function checkThreshold(key, currentValue, triggerAt, recoverAt) {
  const wasAbove = alertActive.get(key) || false;
  if (!wasAbove && currentValue > triggerAt) {
    alertActive.set(key, true);
    return 'triggered';
  }
  if (wasAbove && currentValue < recoverAt) {
    alertActive.set(key, false);
    return 'recovered';
  }
  return null;
}

async function checkAlerts(serverId, metrics) {
  const config = await db.queryOne('SELECT * FROM telegram_config WHERE enabled = 1 LIMIT 1');
  if (!config) return;

  const server = await db.queryOne('SELECT * FROM servers WHERE id = $1', [serverId]);
  if (!server) return;

  const alerts = [];

  if (config.notify_cpu && metrics.cpu_usage != null) {
    const val = Number(metrics.cpu_usage);
    const state = checkThreshold(serverId + ':cpu', val, 90, 70);
    if (state === 'triggered') {
      alerts.push(`<b>High CPU</b> on ${server.hostname}: ${val.toFixed(1)}%`);
    } else if (state === 'recovered') {
      alerts.push(`<b>CPU OK</b> on ${server.hostname}: ${val.toFixed(1)}%`);
    }
  }

  if (config.notify_disk && metrics.disk_total_gb > 0) {
    const diskPct = (Number(metrics.disk_used_gb) / Number(metrics.disk_total_gb)) * 100;
    const state = checkThreshold(serverId + ':disk', diskPct, 90, 70);
    if (state === 'triggered') {
      alerts.push(`<b>Low disk</b> on ${server.hostname}: ${Number(metrics.disk_free_gb).toFixed(1)} GB free (${diskPct.toFixed(1)}%)`);
    } else if (state === 'recovered') {
      alerts.push(`<b>Disk OK</b> on ${server.hostname}: ${Number(metrics.disk_free_gb).toFixed(1)} GB free`);
    }
  }

  if (config.notify_errors) {
    const memPct = Number(metrics.memory_total_mb) > 0
      ? (Number(metrics.memory_used_mb) / Number(metrics.memory_total_mb)) * 100 : 0;
    const state = checkThreshold(serverId + ':mem', memPct, 95, 85);
    if (state === 'triggered') {
      alerts.push(`<b>High memory</b> on ${server.hostname}: ${memPct.toFixed(1)}%`);
    } else if (state === 'recovered') {
      alerts.push(`<b>Memory OK</b> on ${server.hostname}: ${memPct.toFixed(1)}%`);
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
  } catch (err) {
    console.error('[Offline check]', err.message);
  }
}

module.exports = { checkAlerts, checkOfflineServers };
