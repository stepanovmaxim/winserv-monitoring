const db = require('../db');
const { sendTelegramMessage } = require('./telegram');

// Once a day, at the configured hour (server local time), send a fleet summary.
// The UPDATE atomically claims the day's slot so overlapping runs can't double-send.
async function maybeSendDigest() {
  try {
    const claim = await db.query(
      `UPDATE telegram_config SET digest_last_sent = CURRENT_DATE
       WHERE enabled = 1 AND digest_enabled = 1
         AND EXTRACT(HOUR FROM NOW())::int = COALESCE(digest_hour, 9)
         AND (digest_last_sent IS NULL OR digest_last_sent < CURRENT_DATE)
       RETURNING id`
    );
    if (!claim || claim.rowCount === 0) return;

    await sendTelegramMessage(await buildDigest());
    console.log('[Digest] Daily summary sent');
  } catch (err) {
    console.error('[Digest]', err.message);
  }
}

async function buildDigest() {
  const counts = await db.queryOne(
    `SELECT COUNT(*)::int total,
       COUNT(*) FILTER (WHERE status = 'online')::int online,
       COUNT(*) FILTER (WHERE status = 'offline')::int offline
     FROM servers`
  );
  const offline = await db.queryAll("SELECT hostname FROM servers WHERE status = 'offline' ORDER BY hostname LIMIT 20");
  const maint = await db.queryAll(
    `SELECT DISTINCT scope_type FROM maintenance_windows WHERE NOW() BETWEEN starts_at AND ends_at`
  );
  const topDisk = await db.queryAll(
    `SELECT s.hostname, m.disk_used_gb, m.disk_total_gb
     FROM servers s JOIN LATERAL (
       SELECT disk_used_gb, disk_total_gb FROM metrics WHERE server_id = s.id ORDER BY collected_at DESC LIMIT 1
     ) m ON true
     WHERE m.disk_total_gb > 0
     ORDER BY m.disk_used_gb / m.disk_total_gb DESC LIMIT 3`
  );

  const lines = [
    '<b>📊 Daily digest</b>',
    `Servers: ${counts.total} — 🟢 ${counts.online} online, 🔴 ${counts.offline} offline`,
  ];
  if (offline.length) lines.push(`Offline: ${offline.map(o => o.hostname).join(', ')}`);
  if (topDisk.length) {
    lines.push('Top disk usage:');
    for (const d of topDisk) {
      const pct = ((Number(d.disk_used_gb) / Number(d.disk_total_gb)) * 100).toFixed(0);
      lines.push(`• ${d.hostname}: ${pct}%`);
    }
  }
  if (maint.length) lines.push('⏸ Maintenance windows active');
  return lines.join('\n');
}

module.exports = { maybeSendDigest, buildDigest };
