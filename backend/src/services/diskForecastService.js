const db = require('../db');
const { forecastDisk, nextForecastState } = require('../lib/diskForecast');
const { serverLabel } = require('../lib/serverLabel');
const { sendTelegramMessage } = require('./telegram');
const { sendWebhookAlert } = require('./webhookService');
const { logAlert } = require('./alertLog');
const { isMuted } = require('./maintenanceService');

// Two weeks of history, one sample per hour per server: enough to see a trend
// through weekly cycles, small enough to fit in about a second fleet-wide.
const WINDOW_DAYS = parseInt(process.env.FORECAST_WINDOW_DAYS) || 14;

let running = false;

async function runForecasts() {
  if (running) return; // an overrun must not stack a second pass on top
  running = true;
  try {
    const rows = await db.queryAll(
      `SELECT DISTINCT ON (server_id, date_trunc('hour', collected_at))
          server_id, collected_at, disks_json
       FROM metrics
       WHERE collected_at > NOW() - ($1 || ' days')::INTERVAL AND disks_json <> '[]'
       ORDER BY server_id, date_trunc('hour', collected_at), collected_at DESC`,
      [String(WINDOW_DAYS)]
    );

    // server + drive -> hourly points
    const series = new Map();
    for (const r of rows) {
      let disks;
      try { disks = JSON.parse(r.disks_json || '[]'); } catch { continue; }
      if (!Array.isArray(disks)) continue;
      const t = new Date(r.collected_at).getTime();
      for (const d of disks) {
        const drive = String(d.drive || '').trim().slice(0, 20);
        if (!drive) continue;
        const key = r.server_id + '|' + drive;
        if (!series.has(key)) series.set(key, { serverId: r.server_id, drive, points: [] });
        series.get(key).points.push({ t, used: d.used_gb, total: d.total_gb });
      }
    }

    const results = [];
    for (const s of series.values()) {
      const f = forecastDisk(s.points);
      results.push({ ...s, f });
      await db.query(
        `INSERT INTO disk_forecasts (server_id, drive, status, total_gb, used_gb, free_gb, rate_gb_day, days_to_full, r2, points, computed_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW())
         ON CONFLICT (server_id, drive) DO UPDATE SET status=$3, total_gb=$4, used_gb=$5, free_gb=$6,
           rate_gb_day=$7, days_to_full=$8, r2=$9, points=$10, computed_at=NOW()`,
        [s.serverId, s.drive, f.status, f.totalGb ?? null, f.usedGb ?? null, f.freeGb ?? null,
         f.rateGbPerDay ?? null, f.daysToFull ?? null, f.r2 ?? null, f.points || 0]
      );
    }
    // Volumes that stopped reporting (removed disk, silent server) drop out.
    await db.query(`DELETE FROM disk_forecasts WHERE computed_at < NOW() - INTERVAL '3 hours'`);

    await notify(results);
    console.log(`[Forecast] ${results.length} volume(s) forecast`);
  } catch (err) {
    console.error('[Forecast]', err.message);
  } finally {
    running = false;
  }
}

async function notify(results) {
  if (!results.length) return;
  const config = await db.queryOne('SELECT * FROM telegram_config WHERE enabled = 1 LIMIT 1');
  const servers = new Map(
    (await db.queryAll('SELECT id, hostname, display_name, group_id, customer_id FROM servers')).map(s => [s.id, s])
  );

  for (const { serverId, drive, f } of results) {
    const server = servers.get(serverId);
    if (!server) continue;
    const key = `forecast:${serverId}:${drive}`;
    const prev = await db.queryOne('SELECT active FROM alert_state WHERE key = $1', [key]);
    const next = nextForecastState(prev ? prev.active : 0, f);
    if (!prev || prev.active !== next.level) {
      await db.query(
        `INSERT INTO alert_state (key, active, updated_at) VALUES ($1, $2, NOW())
         ON CONFLICT (key) DO UPDATE SET active = $2, updated_at = NOW()`,
        [key, next.level]
      );
    }
    if (!next.notify) continue;

    const label = serverLabel(server);
    let msg, severity;
    if (next.notify === 'recovered') {
      msg = `<b>Disk forecast OK</b> on ${label} ${drive}: no longer filling up`;
      severity = 'info';
    } else {
      const head = next.notify === 'critical' ? 'Disk almost full' : 'Disk filling up';
      msg = `<b>${head}</b> on ${label} ${drive}: ~${f.daysToFull} days until full at +${f.rateGbPerDay} GB/day (${f.freeGb} GB free of ${f.totalGb})`;
      severity = next.notify;
    }
    // Same rule as every other alert: the journal records only what was really
    // dispatched, so a muted or disabled channel logs nothing.
    if (config && config.notify_disk && !(await isMuted(server))) {
      sendTelegramMessage(msg).catch(() => {});
      sendWebhookAlert(msg);
      logAlert({ severity, kind: 'forecast', message: msg, server_id: server.id, customer_id: server.customer_id });
    }
  }
}

module.exports = { runForecasts };
