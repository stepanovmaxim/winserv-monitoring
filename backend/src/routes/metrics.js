const express = require('express');
const { normalizeHostname } = require('../lib/hostname');
const db = require('../db');
const { v4: uuidv4 } = require('uuid');
const { checkAlerts, handleBackOnline } = require('../services/alertService');
const { requireAuth, requireApproved } = require('../middleware/authMiddleware');
const { requireServerAccess } = require('../services/scopeService');
const { broadcast } = require('../services/sseService');
const { assignCustomerByDomain } = require('../services/tenantService');
const { filterValidDisks, diskAggregate } = require('../lib/disk');
const { resolveAgentLatest } = require('../lib/updatePolicy');
const { AGENT_VERSION, LINUX_AGENT_VERSION } = require('./agent');

const REGISTRATION_KEY = process.env.REGISTRATION_KEY || 'winserv-reg-key-change-me';
const router = express.Router();

router.post('/', async (req, res) => {
  const { token, registration_key, hostname: rawHostname, ip_address, os_info, agent_version } = req.body;
  const hostname = normalizeHostname(rawHostname);
  const platform = req.body.platform === 'linux' ? 'linux' : null;
  let { metrics } = req.body;
  const h = hostname || req.body.host || '';

  let serverId = null;

  if (token) {
    const agentRecord = await db.queryOne('SELECT * FROM agent_tokens WHERE token = $1', [token]);
    if (agentRecord) {
      // A token identifies one machine. If the caller reports a different
      // hostname, two machines are sharing one credential - which is exactly
      // what happened when HV1 was handed AVTOSTEK HOST's token: their metrics
      // interleaved in one record, across two different customers. Refuse, and
      // let the caller register under its own name instead of corrupting this
      // one. Compared case-insensitively so casing alone never orphans a host.
      const owner = await db.queryOne('SELECT hostname FROM servers WHERE id = $1', [agentRecord.server_id]);
      const sameHost = !h || !owner || !owner.hostname ||
        owner.hostname.toLowerCase() === h.toLowerCase();
      if (!sameHost) {
        // Warn, do NOT reject. A mismatch is usually innocent: the panel lets an
        // operator rename a server, and its agent still reports the machine's
        // real name - rejecting that took a healthy host offline and spawned a
        // duplicate row, losing its history. The credential is what identifies a
        // machine. The hazard this was meant to catch (two machines sharing one
        // token) can no longer arise, because the ip_address fallback that
        // handed out somebody else's token is gone.
        console.warn('[Identity] token belongs to "%s" but caller reports "%s" (ip %s) - accepted; expected after a rename, investigate if unexpected',
          owner.hostname, h, ip_address || '-');
      }
      serverId = agentRecord.server_id;
    }
  }

  if (!serverId && registration_key === REGISTRATION_KEY && h) {
    // By hostname ONLY. There used to be a fallback that matched any server
    // with the same ip_address, fleet-wide - and private addresses are not
    // unique between customers. A new Hyper-V host reporting 10.0.0.1 was bound
    // to a completely different customer's server that happened to use the same
    // address, inheriting its token and writing into its record every minute.
    // An unknown hostname now simply becomes a new server, which is the honest
    // outcome; a genuine rename is an operator action, not a silent merge.
    let server = await db.queryOne('SELECT * FROM servers WHERE hostname = $1', [h]);
    if (!server) {
      const result = await db.query(
        'INSERT INTO servers (hostname, ip_address, os_info, status) VALUES ($1, $2, $3, $4) RETURNING id',
        [h, ip_address || '', os_info || '', 'online']
      );
      server = { id: result.rows[0].id };
    }
    serverId = server.id;

    let tok = await db.queryOne('SELECT token FROM agent_tokens WHERE server_id = $1', [serverId]);
    if (!tok) {
      const newToken = uuidv4();
      await db.query('INSERT INTO agent_tokens (server_id, token) VALUES ($1, $2)', [serverId, newToken]);
    }
  }

  if (!serverId) {
    // Say WHY, and name the host. A machine that cannot register is otherwise
    // completely invisible: the agent runs, its task ticks, its log looks
    // healthy, and nothing appears in the panel with nothing anywhere to
    // explain it. This is the only place that knows the reason.
    const why = !h
      ? 'no hostname in request'
      : (registration_key === undefined || registration_key === null || registration_key === '')
        ? (token ? 'token not recognised and no registration key sent' : 'no token and no registration key')
        : (registration_key === REGISTRATION_KEY ? 'key valid but no server matched' : 'registration key does NOT match this server');
    console.warn('[Register] REFUSED host=%s ip=%s agent=%s reason=%s',
      h || '(none)', ip_address || '-', agent_version || '?', why);
    return res.status(401).json({ error: 'Valid token or registration_key required' });
  }

  const server = await db.queryOne('SELECT * FROM servers WHERE id = $1', [serverId]);

  if (ip_address) {
    await db.query('UPDATE servers SET ip_address = $1 WHERE id = $2', [ip_address, serverId]);
  }
  if (os_info) {
    await db.query('UPDATE servers SET os_info = $1 WHERE id = $2', [os_info, serverId]);
  }
  if (agent_version) {
    await db.query('UPDATE servers SET agent_version = $1 WHERE id = $2', [agent_version, serverId]);
  }
  if (platform) {
    await db.query('UPDATE servers SET platform = $1 WHERE id = $2', [platform, serverId]);
  }
  // Agents report why their last self-update failed; empty string clears it.
  if (req.body.update_error !== undefined) {
    await db.query('UPDATE servers SET update_error = $1 WHERE id = $2', [String(req.body.update_error || '').slice(0, 500), serverId]);
  }

  const currentHostname = h || server.hostname;
  if (currentHostname && currentHostname.includes('.') && !server.group_id) {
    const domain = currentHostname.substring(currentHostname.indexOf('.') + 1);
    let group = await db.queryOne('SELECT id FROM server_groups WHERE name = $1', [domain]);
    if (!group) {
      const gr = await db.query(
        'INSERT INTO server_groups (name, description) VALUES ($1, $2) RETURNING id',
        [domain, 'Auto-created: servers in ' + domain]
      );
      group = gr.rows[0];
    }
    await db.query('UPDATE servers SET group_id = $1 WHERE id = $2 AND group_id IS NULL', [group.id, serverId]);
  }

  await assignCustomerByDomain(serverId, currentHostname);

  let snapshot = null;

  if (metrics) {
    if (typeof metrics === 'string') {
      try { metrics = JSON.parse(metrics); } catch { metrics = null; }
    }

    if (metrics && typeof metrics === 'object') {
      const cpu_usage = metrics.cpu_usage != null ? Number(metrics.cpu_usage) : null;
      const memory_total_mb = metrics.memory_total_mb != null ? Number(metrics.memory_total_mb) : null;
      const memory_used_mb = metrics.memory_used_mb != null ? Number(metrics.memory_used_mb) : null;
      let disk_total_gb = metrics.disk_total_gb != null ? Number(metrics.disk_total_gb) : null;
      let disk_used_gb = metrics.disk_used_gb != null ? Number(metrics.disk_used_gb) : null;
      let disk_free_gb = metrics.disk_free_gb != null ? Number(metrics.disk_free_gb) : null;
      const uptime_seconds = metrics.uptime_seconds != null ? Math.round(Number(metrics.uptime_seconds)) : null;

      // Mount-point / reparse volumes report free > total (impossible), which
      // dragged the aggregate negative. Keep only real fixed disks, then
      // recompute the totals from them so the numbers are always sane.
      const validDisks = filterValidDisks(metrics.disks);
      const disksJson = JSON.stringify(validDisks);
      const agg = diskAggregate(validDisks);
      if (agg) {
        disk_total_gb = agg.total_gb;
        disk_free_gb = agg.free_gb;
        disk_used_gb = agg.used_gb;
      }

      await db.query(
        `INSERT INTO metrics (server_id, cpu_usage, memory_total_mb, memory_used_mb, disk_total_gb, disk_used_gb, disk_free_gb, disks_json, uptime_seconds)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [serverId, cpu_usage, memory_total_mb, memory_used_mb, disk_total_gb, disk_used_gb, disk_free_gb, disksJson, uptime_seconds]
      );

      checkAlerts(serverId, { cpu_usage, memory_total_mb, memory_used_mb, disk_total_gb, disk_used_gb, disk_free_gb, disks: validDisks });

      snapshot = {
        cpu: cpu_usage,
        mem_pct: memory_total_mb > 0 ? (memory_used_mb / memory_total_mb) * 100 : null,
        disk_pct: disk_total_gb > 0 ? (disk_used_gb / disk_total_gb) * 100 : null,
        mem_used_mb: memory_used_mb,
        mem_total_mb: memory_total_mb,
        disk_used_gb,
        disk_total_gb,
        disks: validDisks,
      };
    }
  }

  const prev = await db.queryOne('SELECT status, hostname FROM servers WHERE id = $1', [serverId]);
  await db.query("UPDATE servers SET last_seen = NOW(), status = 'online' WHERE id = $1", [serverId]);

  if (prev && prev.status === 'offline') {
    handleBackOnline(serverId).catch(err => console.error('[Back online]', err.message));
  }

  const actions = await db.queryAll(
    'SELECT id, label, file_path, enabled AS hidden, applied, logout_users FROM server_actions WHERE server_id = $1',
    [serverId]
  );

  const commands = await db.queryAll(
    "SELECT id, ctype, param FROM server_commands WHERE server_id = $1 AND status = 'pending' ORDER BY created_at",
    [serverId]
  );

  const agentToken = await db.queryOne('SELECT token FROM agent_tokens WHERE server_id = $1', [serverId]);
  const cfgIv = await db.queryOne('SELECT metric_interval, agent_auto_update, ransomware_canary FROM telegram_config LIMIT 1');
  const metric_interval = (cfgIv && cfgIv.metric_interval) ? cfgIv.metric_interval : 1;
  // Watched Event IDs the agent should also collect (beyond critical/error).
  const event_triggers = await db.queryAll('SELECT event_id, log_name FROM event_triggers WHERE enabled = 1');

  // The agent downloads a new version inside its scheduled task, and the task
  // will not start a second instance meanwhile. On a link that trickles, that
  // download blocks the metrics cadence and the host is flagged OFFLINE while
  // being perfectly healthy. With auto-update paused we echo the agent's own
  // version back, so it has nothing to fetch and keeps reporting on time;
  // upgrades are then pushed deliberately via the deployer (SMB copy).
  // Beyond the global pause, a build only rolls out automatically to the
  // Windows releases it can actually be exercised against. See lib/updatePolicy:
  // a 2019-only build silenced every 2012 R2 host in the fleet, and a silent
  // host stops polling, so no later fix can reach it over this channel.
  const autoUpdate = !cfgIv || cfgIv.agent_auto_update !== 0;
  const reported = String(req.body.agent_version || '').trim();
  const isLinux = platform === 'linux' || server.platform === 'linux';
  const osForGate = req.body.os_info || server.os_info;
  // The policy needs the fleet to decide whether this build has already proven
  // itself on this OS family. Only read it while auto-update is actually on.
  const fleet = autoUpdate
    ? await db.queryAll('SELECT id, os_info, agent_version, last_seen FROM servers')
    : [];
  const gate = { autoUpdate, osInfo: osForGate, hosts: fleet, selfId: serverId };
  const winLatest = resolveAgentLatest({ ...gate, reported: !isLinux ? reported : '', latest: AGENT_VERSION });
  const linuxLatest = resolveAgentLatest({ ...gate, reported: isLinux ? reported : '', latest: LINUX_AGENT_VERSION, isLinux });

  // Canary files are only planted when the operator has switched them on.
  const canary = !!(cfgIv && cfgIv.ransomware_canary);
  res.json({ success: true, server_id: serverId, token: agentToken?.token || null, actions, commands, agent_latest: winLatest, linux_agent_latest: linuxLatest, metric_interval, event_triggers, canary });

  // Push the fresh reading to any live dashboards.
  const cust = await db.queryOne('SELECT customer_id FROM servers WHERE id = $1', [serverId]);
  broadcast('metrics', {
    server_id: serverId,
    customer_id: cust?.customer_id || null,
    hostname: prev?.hostname || server.hostname,
    status: 'online',
    last_seen: new Date().toISOString(),
    ...(snapshot || {}),
  });
});

router.get('/:serverId', requireAuth, requireApproved, requireServerAccess(), async (req, res) => {
  const { serverId } = req.params;
  const { hours } = req.query;
  const lookback = hours || 24;

  const metrics = await db.queryAll(
    `SELECT * FROM metrics WHERE server_id = $1 AND collected_at >= NOW() - ($2 || ' hours')::INTERVAL ORDER BY collected_at ASC`,
    [serverId, String(lookback)]
  );

  for (const m of metrics) {
    if (m.disks_json && typeof m.disks_json === 'string') {
      try { m.disks_json = JSON.parse(m.disks_json); } catch { m.disks_json = []; }
    }
  }

  res.json(metrics);
});

// Single most-recent reading — used for the live "current" cards regardless of
// the chart's selected range.
router.get('/:serverId/latest', requireAuth, requireApproved, requireServerAccess(), async (req, res) => {
  const m = await db.queryOne(
    'SELECT * FROM metrics WHERE server_id = $1 ORDER BY collected_at DESC LIMIT 1',
    [req.params.serverId]
  );
  if (m && typeof m.disks_json === 'string') {
    try { m.disks_json = JSON.parse(m.disks_json); } catch { m.disks_json = []; }
  }
  res.json(m || null);
});

// Hourly rollups for long-range charts (fields already percentaged).
router.get('/:serverId/rollup', requireAuth, requireApproved, requireServerAccess(), async (req, res) => {
  const hours = parseInt(req.query.hours) || 720;
  const rows = await db.queryAll(
    `SELECT bucket AS collected_at, cpu_avg, cpu_max, mem_pct_avg, disk_pct_avg
     FROM metrics_hourly
     WHERE server_id = $1 AND bucket >= NOW() - ($2 || ' hours')::INTERVAL
     ORDER BY bucket ASC`,
    [req.params.serverId, String(hours)]
  );
  res.json(rows);
});

module.exports = router;
