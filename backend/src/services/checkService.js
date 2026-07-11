const net = require('net');
const { execFile } = require('child_process');
const db = require('../db');
const { sendTelegramMessage } = require('./telegram');
const { sendWebhookAlert } = require('./webhookService');
const { isMuted } = require('./maintenanceService');

// ICMP ping via the system binary (Node can't do raw ICMP without privileges).
// execFile passes host as an argv element, so there's no shell to inject into.
function pingHost(host) {
  return new Promise((resolve) => {
    execFile('ping', ['-n', '-c', '1', '-w', '3', String(host)], { timeout: 6000 }, (err, stdout) => {
      if (err) return resolve({ status: 'down', latency: null, error: 'unreachable' });
      const m = String(stdout).match(/time[=<]\s*([\d.]+)\s*ms/i);
      resolve({ status: 'up', latency: m ? Math.round(parseFloat(m[1])) : null, error: '' });
    });
  });
}

// TCP connect: success = the port accepts a connection.
function tcpCheck(host, port) {
  return new Promise((resolve) => {
    const start = Date.now();
    const socket = new net.Socket();
    let done = false;
    const finish = (status, error) => {
      if (done) return; done = true;
      socket.destroy();
      resolve({ status, latency: status === 'up' ? Date.now() - start : null, error: error || '' });
    };
    socket.setTimeout(5000);
    socket.once('connect', () => finish('up'));
    socket.once('timeout', () => finish('down', 'timeout'));
    socket.once('error', (e) => finish('down', e.code || 'error'));
    try { socket.connect(Number(port), String(host)); } catch { finish('down', 'bad target'); }
  });
}

async function runCheck(c) {
  if (c.kind === 'ping') return pingHost(c.host);
  if (c.kind === 'tcp') return tcpCheck(c.host, c.port || 0);
  // http/tls are handled by httpCheckService (registered later); default down.
  if (checkExtra[c.kind]) return checkExtra[c.kind](c);
  return { status: 'down', latency: null, error: 'unsupported' };
}

// Lets other modules (item 3: http/tls) plug in without a circular require.
const checkExtra = {};
function registerCheckKind(kind, fn) { checkExtra[kind] = fn; }

async function notifyCheck(c, r) {
  try {
    const cfg = await db.queryOne('SELECT * FROM telegram_config WHERE enabled = 1 LIMIT 1');
    if (!cfg) return;
    const muted = await isMuted({ id: 0, group_id: 0, customer_id: c.customer_id });
    if (muted) return;
    const where = c.host + (c.port ? ':' + c.port : '');
    const msg = r.status === 'down'
      ? `<b>CHECK DOWN</b> ${c.name} (${where})${r.error ? ' — ' + r.error : ''}`
      : `<b>CHECK UP</b> ${c.name} (${where})${r.latency != null ? ' — ' + r.latency + ' ms' : ''}`;
    sendTelegramMessage(msg).catch(() => {});
    sendWebhookAlert(msg);
  } catch (err) {
    console.error('[Check alert]', err.message);
  }
}

async function runDueChecks() {
  try {
    const due = await db.queryAll(
      `SELECT * FROM checks
       WHERE enabled = 1
         AND (last_checked IS NULL OR last_checked < NOW() - (interval_sec || ' seconds')::INTERVAL)`
    );
    await Promise.all(due.map(async (c) => {
      let r;
      try { r = await runCheck(c); } catch (e) { r = { status: 'down', latency: null, error: e.message }; }
      const prev = c.status;
      await db.query(
        'UPDATE checks SET status = $1, last_latency_ms = $2, last_checked = NOW(), last_error = $3 WHERE id = $4',
        [r.status, r.latency, String(r.error || '').slice(0, 200), c.id]
      );
      if (r.status !== prev) {
        await db.query(
          'INSERT INTO check_events (check_id, status, latency_ms, detail) VALUES ($1, $2, $3, $4)',
          [c.id, r.status, r.latency, String(r.error || '').slice(0, 200)]
        );
        // Alert on any real transition, and on a target that starts already down.
        if (prev !== 'unknown' || r.status === 'down') await notifyCheck(c, r);
      }
    }));
  } catch (err) {
    console.error('[Checks]', err.message);
  }
}

module.exports = { runDueChecks, runCheck, pingHost, tcpCheck, registerCheckKind };
