const net = require('net');
const tls = require('tls');
const { execFile } = require('child_process');
const nodeFetch = require('node-fetch');
const db = require('../db');
const { sendTelegramMessage } = require('./telegram');
const { sendWebhookAlert } = require('./webhookService');
const { isMuted } = require('./maintenanceService');

const CERT_WARN_DAYS = 14;
const certWarned = new Map();

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

// HTTP: GET the URL (stored in host), up if it answers < 400.
async function httpCheck(c) {
  const url = /^https?:\/\//i.test(c.host) ? c.host : 'http://' + c.host;
  const start = Date.now();
  try {
    const res = await nodeFetch(url, { method: 'GET', timeout: 9000, redirect: 'follow', headers: { 'User-Agent': 'WinServ-Monitor' } });
    const latency = Date.now() - start;
    const ok = res.status < 400;
    return { status: ok ? 'up' : 'down', latency, error: ok ? '' : 'HTTP ' + res.status };
  } catch (e) {
    return { status: 'down', latency: null, error: (e.code || e.message || 'error').toString().slice(0, 60) };
  }
}

// TLS: read the peer cert (even if expired/self-signed) and report expiry.
function tlsCheck(c) {
  return new Promise((resolve) => {
    const host = c.host, port = c.port || 443;
    const start = Date.now();
    let done = false;
    const finish = (o) => { if (done) return; done = true; try { socket.destroy(); } catch {} resolve(o); };
    const socket = tls.connect({ host, port, servername: host, timeout: 9000, rejectUnauthorized: false }, () => {
      const cert = socket.getPeerCertificate();
      if (!cert || !cert.valid_to) return finish({ status: 'down', latency: null, error: 'no certificate' });
      const expires = new Date(cert.valid_to);
      const daysLeft = Math.floor((expires.getTime() - Date.now()) / 86400000);
      finish({ status: daysLeft > 0 ? 'up' : 'down', latency: Date.now() - start, error: daysLeft > 0 ? '' : 'certificate expired', cert_expires_at: expires.toISOString(), daysLeft });
    });
    socket.once('timeout', () => finish({ status: 'down', latency: null, error: 'timeout' }));
    socket.once('error', (e) => finish({ status: 'down', latency: null, error: (e.code || 'error').toString() }));
  });
}

async function runCheck(c) {
  if (c.kind === 'ping') return pingHost(c.host);
  if (c.kind === 'tcp') return tcpCheck(c.host, c.port || 0);
  if (c.kind === 'http') return httpCheck(c);
  if (c.kind === 'tls') return tlsCheck(c);
  return { status: 'down', latency: null, error: 'unsupported' };
}

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
        `UPDATE checks SET status = $1, last_latency_ms = $2, last_checked = NOW(), last_error = $3,
           cert_expires_at = COALESCE($4, cert_expires_at) WHERE id = $5`,
        [r.status, r.latency, String(r.error || '').slice(0, 200), r.cert_expires_at || null, c.id]
      );
      if (r.status !== prev) {
        await db.query(
          'INSERT INTO check_events (check_id, status, latency_ms, detail) VALUES ($1, $2, $3, $4)',
          [c.id, r.status, r.latency, String(r.error || '').slice(0, 200)]
        );
        // Alert on any real transition, and on a target that starts already down.
        if (prev !== 'unknown' || r.status === 'down') await notifyCheck(c, r);
      }
      // Certificate-expiry warning (separate from up/down), once per day per check.
      if (c.kind === 'tls' && r.daysLeft != null && r.daysLeft > 0 && r.daysLeft <= CERT_WARN_DAYS) {
        const last = certWarned.get(c.id) || 0;
        if (Date.now() - last > 24 * 60 * 60 * 1000) {
          certWarned.set(c.id, Date.now());
          const cfg = await db.queryOne('SELECT id FROM telegram_config WHERE enabled = 1 LIMIT 1');
          if (cfg && !(await isMuted({ id: 0, group_id: 0, customer_id: c.customer_id }))) {
            const m = `<b>TLS expiring</b> ${c.name} (${c.host}): ${r.daysLeft} day(s) left`;
            sendTelegramMessage(m).catch(() => {});
            sendWebhookAlert(m);
          }
        }
      }
    }));
  } catch (err) {
    console.error('[Checks]', err.message);
  }
}

module.exports = { runDueChecks, runCheck, pingHost, tcpCheck };
