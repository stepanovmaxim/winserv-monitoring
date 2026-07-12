const db = require('../db');
const { sendTelegramMessage } = require('./telegram');
const { broadcast } = require('./sseService');
const { isMuted } = require('./maintenanceService');
const { sendWebhookAlert } = require('./webhookService');
const { logAlert } = require('./alertLog');
const { firstNum, thresholdTransition } = require('../lib/thresholds');

const alertActive = new Map();
const onlineCooldown = new Map();
const flapAlerted = new Map();
const serverStart = Date.now();
const GRACE_MS = 2 * 60 * 1000;

// Mirror flag changes to the DB so a restart doesn't re-fire alerts that were
// already active (or miss recoveries that happened while we were down).
function persistState(key, active) {
  db.query(
    `INSERT INTO alert_state (key, active, updated_at) VALUES ($1, $2, NOW())
     ON CONFLICT (key) DO UPDATE SET active = $2, updated_at = NOW()`,
    [key, active ? 1 : 0]
  ).catch(err => console.error('[Alert state] persist:', err.message));
}

async function loadAlertState() {
  try {
    const rows = await db.queryAll('SELECT key, active FROM alert_state');
    for (const r of rows) alertActive.set(r.key, !!r.active);
    console.log(`[Alert state] Restored ${rows.length} flags`);
  } catch (err) {
    console.error('[Alert state] load:', err.message);
  }
}

function checkThreshold(key, currentValue, triggerAt, recoverAt) {
  const wasAbove = alertActive.get(key) || false;
  const t = thresholdTransition(wasAbove, currentValue, triggerAt, recoverAt);
  if (t === 'triggered') { alertActive.set(key, true); persistState(key, true); }
  else if (t === 'recovered') { alertActive.set(key, false); persistState(key, false); }
  return t;
}

function logStatus(serverId, status) {
  return db.query('INSERT INTO status_log (server_id, status) VALUES ($1, $2)', [serverId, status])
    .catch(err => console.error('[Status log]', err.message));
}

// Hottest processes from the latest snapshot, e.g. "rphost 74%, sqlservr 12%".
async function topProcesses(serverId, n = 3) {
  try {
    const rows = await db.queryAll(
      'SELECT name, cpu_pct FROM process_snapshot WHERE server_id = $1 AND cpu_pct > 5 ORDER BY cpu_pct DESC LIMIT $2',
      [serverId, n]
    );
    return rows.map(r => `${r.name} ${Math.round(r.cpu_pct)}%`).join(', ');
  } catch { return ''; }
}

// A server that toggles state too often in an hour is flapping; alert once, then
// stay quiet for an hour so we don't spam.
async function checkFlapping(server, config) {
  const threshold = firstNum(config?.flap_threshold) || 6;
  const row = await db.queryOne(
    `SELECT COUNT(*)::int AS n FROM status_log WHERE server_id = $1 AND changed_at > NOW() - INTERVAL '1 hour'`,
    [server.id]
  );
  if (!row || row.n < threshold) return;
  const last = flapAlerted.get(server.id) || 0;
  if (Date.now() - last < 60 * 60 * 1000) return;
  flapAlerted.set(server.id, Date.now());
  if (config?.notify_offline && !(await isMuted(server))) {
    const msg = `<b>FLAPPING</b>: ${server.hostname} changed state ${row.n}× in the last hour`;
    sendTelegramMessage(msg).catch(() => {});
    logAlert({ severity: 'warning', kind: 'flapping', message: msg, server_id: server.id, customer_id: server.customer_id });
  }
}

async function checkAlerts(serverId, metrics) {
  const config = await db.queryOne('SELECT * FROM telegram_config WHERE enabled = 1 LIMIT 1');
  if (!config) return;

  const server = await db.queryOne(
    `SELECT s.*,
        g.cpu_threshold AS g_cpu, g.memory_threshold AS g_mem, g.disk_threshold AS g_disk,
        c.cpu_threshold AS c_cpu, c.memory_threshold AS c_mem, c.disk_threshold AS c_disk
     FROM servers s
     LEFT JOIN server_groups g ON s.group_id = g.id
     LEFT JOIN customers c ON s.customer_id = c.id
     WHERE s.id = $1`,
    [serverId]
  );
  if (!server) return;
  if (await isMuted(server)) return;

  const cpuT = firstNum(server.cpu_threshold, server.g_cpu, server.c_cpu, config.cpu_threshold) ?? 90;
  const memT = firstNum(server.memory_threshold, server.g_mem, server.c_mem, config.memory_threshold) ?? 95;
  const diskT = firstNum(server.disk_threshold, server.g_disk, server.c_disk, config.disk_threshold) ?? 90;

  const alerts = [];

  if (config.notify_cpu && server.notify_cpu && metrics.cpu_usage != null) {
    const val = Number(metrics.cpu_usage);
    const state = checkThreshold(serverId + ':cpu', val, cpuT, cpuT - 20);
    if (state === 'triggered') {
      // Name the culprit: append the hottest processes from the latest snapshot.
      const top = await topProcesses(serverId);
      alerts.push(`<b>High CPU</b> on ${server.hostname}: ${val.toFixed(1)}% (>${cpuT}%)${top ? ' — top: ' + top : ''}`);
    }
    else if (state === 'recovered') alerts.push(`<b>CPU OK</b> on ${server.hostname}: ${val.toFixed(1)}%`);
  }

  if (config.notify_disk && server.notify_disk) {
    // Check each disk separately — a single full volume must alert even if the
    // fleet-wide total still looks fine.
    const disks = Array.isArray(metrics.disks) && metrics.disks.length
      ? metrics.disks
      : (metrics.disk_total_gb > 0 ? [{ drive: '', total_gb: metrics.disk_total_gb, used_gb: metrics.disk_used_gb, free_gb: metrics.disk_free_gb }] : []);
    for (const d of disks) {
      const total = Number(d.total_gb), used = Number(d.used_gb), free = Number(d.free_gb);
      if (!(total > 0)) continue;
      const pct = (used / total) * 100;
      const label = d.drive ? ` (${d.drive})` : '';
      const state = checkThreshold(`${serverId}:disk:${d.drive || 'all'}`, pct, diskT, diskT - 20);
      if (state === 'triggered') alerts.push(`<b>Low disk</b> on ${server.hostname}${label}: ${free.toFixed(1)} GB free (${pct.toFixed(1)}%)`);
      else if (state === 'recovered') alerts.push(`<b>Disk OK</b> on ${server.hostname}${label}: ${free.toFixed(1)} GB free`);
    }
  }

  if (config.notify_errors && server.notify_memory) {
    const memPct = Number(metrics.memory_total_mb) > 0
      ? (Number(metrics.memory_used_mb) / Number(metrics.memory_total_mb)) * 100 : 0;
    const state = checkThreshold(serverId + ':mem', memPct, memT, memT - 10);
    if (state === 'triggered') alerts.push(`<b>High memory</b> on ${server.hostname}: ${memPct.toFixed(1)}% (>${memT}%)`);
    else if (state === 'recovered') alerts.push(`<b>Memory OK</b> on ${server.hostname}: ${memPct.toFixed(1)}%`);
  }

  if (alerts.length > 0 && Date.now() - serverStart > GRACE_MS) {
    const msg = alerts.join('\n');
    sendTelegramMessage(msg).catch(err => console.error('[Alert]', err.message));
    sendWebhookAlert(msg);
    const recoveredOnly = alerts.every(a => / OK<\/b>/.test(a));
    logAlert({ severity: recoveredOnly ? 'info' : 'warning', kind: 'threshold', message: msg, server_id: serverId, customer_id: server.customer_id });
  }
}

// Called from metrics ingest when a server transitions offline → online.
async function handleBackOnline(serverId) {
  const server = await db.queryOne('SELECT id, hostname, group_id, customer_id FROM servers WHERE id = $1', [serverId]);
  if (!server) return;
  await logStatus(serverId, 'online');
  const config = await db.queryOne('SELECT * FROM telegram_config WHERE enabled = 1 LIMIT 1');
  await checkFlapping(server, config);
  if (!config || !config.notify_offline) return;
  if (await isMuted(server)) return;
  const key = serverId + ':online';
  const now = Date.now();
  if (now - (onlineCooldown.get(key) || 0) > 300000) {
    onlineCooldown.set(key, now);
    sendTelegramMessage(`<b>ONLINE</b>: ${server.hostname} is back`).catch(() => {});
    logAlert({ severity: 'info', kind: 'online', message: `ONLINE: ${server.hostname} is back`, server_id: server.id, customer_id: server.customer_id });
  }
}

async function checkOfflineServers() {
  try {
    const config = await db.queryOne('SELECT * FROM telegram_config WHERE enabled = 1 LIMIT 1');
    const mins = (config && config.offline_minutes) ? parseInt(config.offline_minutes) : 3;

    const justOffline = await db.queryAll(
      `UPDATE servers SET status = 'offline'
       WHERE status = 'online' AND (last_seen IS NULL OR last_seen < NOW() - ($1 || ' minutes')::INTERVAL)
       RETURNING id, hostname, group_id, customer_id`,
      [String(mins)]
    );

    const toNotify = [];
    for (const s of justOffline) {
      broadcast('status', { server_id: s.id, customer_id: s.customer_id, hostname: s.hostname, status: 'offline' });
      await logStatus(s.id, 'offline');
      await checkFlapping(s, config);
      if (!(await isMuted(s))) toNotify.push(s);
    }

    if (config && config.notify_offline && toNotify.length > 0) {
      const names = toNotify.map(s => s.hostname).join(', ');
      const msg = `<b>OFFLINE (${toNotify.length})</b>: ${names}`;
      sendTelegramMessage(msg).catch(() => {});
      sendWebhookAlert(msg);
      for (const s of toNotify) logAlert({ severity: 'critical', kind: 'offline', message: `OFFLINE: ${s.hostname}`, server_id: s.id, customer_id: s.customer_id });
    }
  } catch (err) {
    console.error('[Offline check]', err.message);
  }
}

module.exports = { checkAlerts, checkOfflineServers, loadAlertState, handleBackOnline };
