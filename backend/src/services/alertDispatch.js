const db = require('../db');
const { sendTelegramMessage, editTelegramMessage } = require('./telegram');
const { sendWebhookAlert } = require('./webhookService');
const { insertAlert, strip } = require('./alertLog');
const { joinsGroup, repeatSuffix } = require('../lib/alertGroup');

// Send an alert to every channel and record it in the journal.
//
// With a groupKey, a repeat of the same condition inside the window does not
// produce a new notification: the journal row gets a counter and the original
// Telegram message is edited in place (an edit does not ping anyone). Without
// a key this is exactly the old send + log. Never throws.
async function dispatchAlert({ text, severity = 'warning', kind = '', server_id = null, customer_id = null, groupKey = null, groupHours = 24 }) {
  try {
    if (groupKey) {
      const open = await db.queryOne(
        `SELECT id, created_at, repeat_count, tg_message_id FROM alerts
         WHERE group_key = $1 ORDER BY created_at DESC LIMIT 1`,
        [groupKey]
      );
      if (open && joinsGroup({ firstAt: open.created_at, windowHours: groupHours })) {
        const count = (open.repeat_count || 1) + 1;
        await db.query(
          'UPDATE alerts SET repeat_count = $1, last_at = NOW(), message = $2 WHERE id = $3',
          [count, strip(text).slice(0, 600), open.id]
        );
        if (open.tg_message_id) {
          editTelegramMessage(open.tg_message_id, `${text}\n${repeatSuffix({ count, firstAt: open.created_at })}`).catch(() => {});
        }
        return { grouped: true, count };
      }
    }

    sendWebhookAlert(text);
    let id = null;
    try { id = await insertAlert({ severity, kind, message: text, server_id, customer_id, group_key: groupKey }); }
    catch (err) { console.error('[AlertLog]', err.message); }
    const sent = sendTelegramMessage(text);
    if (groupKey && id) {
      // Remember which message to edit when this condition repeats.
      sent.then((data) => {
        const mid = data && data.result && data.result.message_id;
        if (mid) return db.query('UPDATE alerts SET tg_message_id = $1 WHERE id = $2', [mid, id]);
      }).catch(() => {});
    } else {
      sent.catch(() => {});
    }
    return { grouped: false };
  } catch (err) {
    console.error('[AlertDispatch]', err.message);
    return { grouped: false };
  }
}

module.exports = { dispatchAlert };
