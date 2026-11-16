const db = require('../db');
const { commandParam, jobTimedOut } = require('../lib/winUpdates');
const { logAction } = require('./auditService');

// How long alerts for the host stay muted once an install starts. Shortened to
// what is actually needed as soon as the result arrives.
const WINDOW_HOURS = 3;

// Hand a job to the agent: queue the command and open a maintenance window so
// the install (stopped services, a reboot) does not page anyone.
async function queueJob(job) {
  const cmd = await db.query(
    "INSERT INTO server_commands (server_id, ctype, param, requested_by) VALUES ($1, 'install_updates', $2, $3) RETURNING id",
    [job.server_id, commandParam(job), job.created_by || 'system']
  );
  const win = await db.query(
    `INSERT INTO maintenance_windows (scope_type, scope_id, starts_at, ends_at, reason, created_by)
     VALUES ('server', $1, NOW(), NOW() + ($2 || ' hours')::interval, 'Windows updates (automatic)', $3) RETURNING id`,
    [job.server_id, String(WINDOW_HOURS), job.created_by || 'system']
  );
  await db.query(
    `UPDATE update_jobs SET status = 'queued', queued_at = NOW(), command_id = $1, window_id = $2 WHERE id = $3`,
    [cmd.rows[0].id, win.rows[0].id, job.id]
  );
}

async function failJob(job, why) {
  await db.query(
    `UPDATE update_jobs SET status = 'failed', summary = $1, finished_at = NOW() WHERE id = $2`,
    [String(why).slice(0, 300), job.id]
  );
  // A command that was never picked up must not fire later, outside the window.
  if (job.command_id) await db.query("DELETE FROM server_commands WHERE id = $1 AND status = 'pending'", [job.command_id]);
  if (job.window_id) await db.query('UPDATE maintenance_windows SET ends_at = NOW() WHERE id = $1 AND ends_at > NOW()', [job.window_id]);
}

// Scheduler tick: start jobs whose time has come, give up on stale ones.
let running = false;
async function runUpdateJobs() {
  if (running) return;
  running = true;
  try {
    const due = await db.queryAll(`SELECT * FROM update_jobs WHERE status = 'scheduled' AND run_at <= NOW() ORDER BY run_at LIMIT 20`);
    for (const raw of due) {
      const job = { ...raw, ids: JSON.parse(raw.ids_json || '[]') };
      await queueJob(job);
      const s = await db.queryOne('SELECT hostname FROM servers WHERE id = $1', [job.server_id]);
      logAction({ server_id: job.server_id, hostname: s ? s.hostname : '', label: `install updates (${job.scope})`, new_state: 'QUEUED', source: 'schedule', actor: job.created_by });
      console.log(`[Updates] Job ${job.id} queued for server ${job.server_id}`);
    }
    const open = await db.queryAll(`SELECT * FROM update_jobs WHERE status IN ('queued', 'running')`);
    for (const job of open) {
      const why = jobTimedOut(job);
      if (why) { await failJob(job, why); console.log(`[Updates] Job ${job.id} failed: ${why}`); }
    }
  } catch (err) {
    console.error('[Updates]', err.message);
  } finally {
    running = false;
  }
}

module.exports = { queueJob, failJob, runUpdateJobs };
