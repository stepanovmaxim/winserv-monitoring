const express = require('express');
const db = require('../db');
const { requireAuth, requireApproved, requireAdmin } = require('../middleware/authMiddleware');
const { requireServerAccess, canSeeServer } = require('../services/scopeService');
const { logAction } = require('../services/auditService');
const { dispatchAlert } = require('../services/alertDispatch');
const { queueJob, failJob } = require('../services/updateService');
const { serverLabel } = require('../lib/serverLabel');
const { MIN_AGENT, versionAtLeast, normalizeUpdate, buildJob, summarizeResult, resultText } = require('../lib/winUpdates');

const router = express.Router();

// Agent upload: the latest scan and/or the outcome of an install run.
router.post('/', async (req, res) => {
  const { token, scan, result } = req.body;
  if (!token) return res.status(401).json({ error: 'token required' });
  const agent = await db.queryOne('SELECT server_id FROM agent_tokens WHERE token = $1', [token]);
  if (!agent) return res.status(401).json({ error: 'invalid token' });
  const server = await db.queryOne('SELECT id, hostname, display_name, customer_id FROM servers WHERE id = $1', [agent.server_id]);
  if (!server) return res.status(404).json({ error: 'server not found' });

  if (scan && typeof scan === 'object') {
    if (scan.ok) {
      const seen = new Set();
      const list = (Array.isArray(scan.updates) ? scan.updates : []).slice(0, 500).map(normalizeUpdate)
        .filter(u => u && !seen.has(u.id) && seen.add(u.id));
      await db.query('DELETE FROM windows_updates WHERE server_id = $1', [server.id]);
      for (const u of list) {
        await db.query(
          `INSERT INTO windows_updates (server_id, update_id, title, kb, severity, categories, size_mb, downloaded, security, preview, upgrade)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
          [server.id, u.id, u.title, u.kb, u.severity, u.categories, u.size_mb, u.downloaded ? 1 : 0, u.security ? 1 : 0, u.preview ? 1 : 0, u.upgrade ? 1 : 0]
        );
      }
      await db.query(`UPDATE servers SET wu_scan_at = NOW(), wu_error = '', wu_reboot_required = $1 WHERE id = $2`,
        [scan.reboot_required ? 1 : 0, server.id]);
    } else {
      // A failed search says nothing about what is pending: keep the last list.
      await db.query('UPDATE servers SET wu_error = $1, wu_error_at = NOW() WHERE id = $2', [String(scan.error || 'scan failed').slice(0, 300), server.id]);
    }
  }

  if (result && typeof result === 'object') {
    const job = await db.queryOne(
      `SELECT * FROM update_jobs WHERE id = $1 AND server_id = $2 AND status IN ('queued', 'running')`,
      [parseInt(result.job) || 0, server.id]
    );
    if (job) {
      const s = summarizeResult(result);
      const text = resultText(serverLabel(server), s);
      await db.query(
        `UPDATE update_jobs SET status = $1, summary = $2, result_json = $3, finished_at = NOW(),
           started_at = COALESCE(started_at, NOW()) WHERE id = $4`,
        [s.ok ? 'done' : 'failed', text.replace(/<[^>]+>/g, '').slice(0, 300), JSON.stringify(s).slice(0, 60000), job.id]
      );
      // Keep the mute just long enough for a reboot, otherwise lift it now.
      if (job.window_id) {
        await db.query(`UPDATE maintenance_windows SET ends_at = NOW() + ($1 || ' minutes')::interval WHERE id = $2 AND ends_at > NOW()`,
          [s.will_reboot ? '20' : '0', job.window_id]);
      }
      // The outcome of a requested job is reported even inside its own window.
      dispatchAlert({ text, severity: s.ok ? 'info' : 'warning', kind: 'updates', server_id: server.id, customer_id: server.customer_id });
    }
  }

  res.json({ success: true });
});

// Pending updates and recent install jobs for one server.
router.get('/:serverId', requireAuth, requireApproved, requireServerAccess(), async (req, res) => {
  const id = req.params.serverId;
  const server = await db.queryOne('SELECT agent_version, platform, wu_scan_at, wu_error, wu_error_at, wu_reboot_required FROM servers WHERE id = $1', [id]);
  if (!server) return res.status(404).json({ error: 'server not found' });
  const [updates, jobs] = await Promise.all([
    db.queryAll('SELECT * FROM windows_updates WHERE server_id = $1 ORDER BY security DESC, preview, title', [id]),
    db.queryAll('SELECT * FROM update_jobs WHERE server_id = $1 ORDER BY id DESC LIMIT 15', [id]),
  ]);
  res.json({
    supported: server.platform !== 'linux' && versionAtLeast(server.agent_version, MIN_AGENT),
    scan_at: server.wu_scan_at,
    // An error older than the last good scan is history, not the current state.
    error: server.wu_error && (!server.wu_scan_at || new Date(server.wu_error_at) > new Date(server.wu_scan_at)) ? server.wu_error : '',
    reboot_required: !!server.wu_reboot_required,
    updates,
    jobs: jobs.map(j => { let result = null; try { result = j.result_json ? JSON.parse(j.result_json) : null; } catch {} return { ...j, result_json: undefined, ids_json: undefined, result }; }),
  });
});

async function adminServer(req, res) {
  const server = await db.queryOne('SELECT id, hostname, agent_version, platform FROM servers WHERE id = $1', [req.params.serverId]);
  if (!server) { res.status(404).json({ error: 'server not found' }); return null; }
  if (!(await canSeeServer(req.user, server.id))) { res.status(403).json({ error: 'No access to this server' }); return null; }
  if (server.platform === 'linux' || !versionAtLeast(server.agent_version, MIN_AGENT)) {
    res.status(400).json({ error: `agent ${MIN_AGENT}+ on Windows is required` }); return null;
  }
  return server;
}

// Ask the host to search for updates now.
router.post('/:serverId/scan', requireAuth, requireAdmin, async (req, res) => {
  const server = await adminServer(req, res);
  if (!server) return;
  const pending = await db.queryOne("SELECT 1 FROM server_commands WHERE server_id = $1 AND ctype = 'wu_scan' AND status = 'pending'", [server.id]);
  if (!pending) await db.query("INSERT INTO server_commands (server_id, ctype, param, requested_by) VALUES ($1, 'wu_scan', '', $2)", [server.id, req.user.email]);
  res.json({ success: true });
});

// Install now, or schedule for later. One open job per server.
router.post('/:serverId/install', requireAuth, requireAdmin, async (req, res) => {
  const server = await adminServer(req, res);
  if (!server) return;
  const built = buildJob(req.body || {});
  if (built.error) return res.status(400).json({ error: built.error });
  const open = await db.queryOne(`SELECT id FROM update_jobs WHERE server_id = $1 AND status IN ('scheduled', 'queued', 'running')`, [server.id]);
  if (open) return res.status(409).json({ error: 'this server already has an update job in progress or scheduled' });

  const r = await db.query(
    `INSERT INTO update_jobs (server_id, scope, ids_json, reboot, run_at, created_by)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [server.id, built.scope, JSON.stringify(built.ids), built.reboot ? 1 : 0, built.runAt.toISOString(), req.user.email]
  );
  const job = { ...r.rows[0], ids: built.ids };
  const later = built.runAt.getTime() > Date.now() + 30000;
  if (!later) await queueJob(job);
  logAction({ action_id: job.id, server_id: server.id, hostname: server.hostname,
    label: `install updates (${built.scope}${built.reboot ? ', reboot' : ''})`, new_state: later ? 'SCHEDULED' : 'QUEUED', source: 'web', actor: req.user.email });
  res.json({ id: job.id, scheduled: later });
});

// Cancel a job that has not reached the host yet.
router.post('/jobs/:id/cancel', requireAuth, requireAdmin, async (req, res) => {
  const job = await db.queryOne('SELECT * FROM update_jobs WHERE id = $1', [req.params.id]);
  if (!job) return res.status(404).json({ error: 'job not found' });
  if (!(await canSeeServer(req.user, job.server_id))) return res.status(403).json({ error: 'No access to this server' });
  if (job.status === 'scheduled') {
    await db.query(`UPDATE update_jobs SET status = 'cancelled', finished_at = NOW(), summary = $1 WHERE id = $2`, ['cancelled by ' + req.user.email, job.id]);
  } else if (job.status === 'queued') {
    // Only if the command is still waiting: once the host has it, it runs.
    const gone = await db.query("DELETE FROM server_commands WHERE id = $1 AND status = 'pending'", [job.command_id]);
    if (gone.rowCount === 0) return res.status(409).json({ error: 'the host has already started this job' });
    await failJob({ ...job, command_id: null }, 'cancelled by ' + req.user.email);
    await db.query(`UPDATE update_jobs SET status = 'cancelled' WHERE id = $1`, [job.id]);
  } else {
    return res.status(409).json({ error: 'this job can no longer be cancelled' });
  }
  res.json({ success: true });
});

module.exports = router;
