const db = require('../db');
const { logAction } = require('./auditService');

// Fire daily hide/show for file-actions at their configured HH:MM (server local
// time). Idempotent: only flips actions whose state differs from the target, so
// running twice inside the same minute can't re-trigger the agent.
async function runScheduledActions() {
  try {
    const { hm } = await db.queryOne("SELECT to_char(NOW(), 'HH24:MI') AS hm");

    const toHide = await db.queryAll(
      `UPDATE server_actions sa SET enabled = 1, applied = 0
       FROM servers s WHERE sa.server_id = s.id
         AND sa.schedule_enabled = 1 AND sa.schedule_hide = $1 AND sa.enabled = 0
       RETURNING sa.id, sa.server_id, sa.label, s.hostname`,
      [hm]
    );
    const toShow = await db.queryAll(
      `UPDATE server_actions sa SET enabled = 0, applied = 0
       FROM servers s WHERE sa.server_id = s.id
         AND sa.schedule_enabled = 1 AND sa.schedule_show = $1 AND sa.enabled = 1
       RETURNING sa.id, sa.server_id, sa.label, s.hostname`,
      [hm]
    );

    for (const a of toHide) logAction({ action_id: a.id, server_id: a.server_id, hostname: a.hostname, label: a.label, new_state: 'HIDDEN', source: 'schedule', actor: 'scheduler' });
    for (const a of toShow) logAction({ action_id: a.id, server_id: a.server_id, hostname: a.hostname, label: a.label, new_state: 'VISIBLE', source: 'schedule', actor: 'scheduler' });
    if (toHide.length || toShow.length) console.log(`[Schedule] ${hm}: hid ${toHide.length}, showed ${toShow.length}`);
  } catch (err) {
    console.error('[Schedule]', err.message);
  }
}

module.exports = { runScheduledActions };
