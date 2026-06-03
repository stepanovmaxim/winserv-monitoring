const express = require('express');
const { requireAuth, requireAdmin } = require('../middleware/authMiddleware');
const db = require('../db');

const router = express.Router();

const defaults = {
  bot_token: '', chat_id: '', enabled: false,
  notify_disk: true, notify_cpu: true, notify_errors: true, notify_offline: true,
  offline_minutes: 3,
};

router.get('/config', requireAuth, requireAdmin, async (req, res) => {
  const config = await db.queryOne('SELECT * FROM telegram_config LIMIT 1');
  res.json(config || defaults);
});

router.put('/config', requireAuth, requireAdmin, async (req, res) => {
  const { bot_token, chat_id, enabled, notify_disk, notify_cpu, notify_errors, notify_offline, offline_minutes } = req.body;

  const existing = await db.queryOne('SELECT * FROM telegram_config LIMIT 1');

  if (existing) {
    await db.query(
      `UPDATE telegram_config SET bot_token = $1, chat_id = $2, enabled = $3,
       notify_disk = $4, notify_cpu = $5, notify_errors = $6, notify_offline = $7, offline_minutes = $8
       WHERE id = $9`,
      [
        bot_token !== undefined ? bot_token : existing.bot_token,
        chat_id !== undefined ? chat_id : existing.chat_id,
        enabled !== undefined ? (enabled ? 1 : 0) : existing.enabled,
        notify_disk !== undefined ? (notify_disk ? 1 : 0) : existing.notify_disk,
        notify_cpu !== undefined ? (notify_cpu ? 1 : 0) : existing.notify_cpu,
        notify_errors !== undefined ? (notify_errors ? 1 : 0) : existing.notify_errors,
        notify_offline !== undefined ? (notify_offline ? 1 : 0) : existing.notify_offline,
        offline_minutes !== undefined ? parseInt(offline_minutes) || 3 : existing.offline_minutes,
        existing.id
      ]
    );
  } else {
    await db.query(
      `INSERT INTO telegram_config (bot_token, chat_id, enabled, notify_disk, notify_cpu, notify_errors, notify_offline, offline_minutes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [bot_token || '', chat_id || '', enabled ? 1 : 0, notify_disk ? 1 : 0, notify_cpu ? 1 : 0, notify_errors ? 1 : 0, notify_offline ? 1 : 0, parseInt(offline_minutes) || 3]
    );
  }

  res.json({ success: true });
});

router.post('/test', requireAuth, requireAdmin, async (req, res) => {
  const { sendTelegramMessage } = require('../services/telegram');
  try {
    await sendTelegramMessage('Test message from WinServ Monitoring');
    res.json({ success: true, message: 'Test message sent' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/webhook', async (req, res) => {
  try {
    const msg = req.body?.message || req.body?.callback_query?.message;
    if (!msg) return res.sendStatus(200);
    const text = (msg.text || '').trim();
    const chatId = msg.chat?.id;
    if (!chatId || !text.startsWith('/')) return res.sendStatus(200);

    const { sendTelegramMessage } = require('../services/telegram');
    const parts = text.split(/\s+/);
    const cmd = parts[0].toLowerCase();

    if (cmd === '/list' || cmd === '/status') {
      const actions = await db.queryAll(
        'SELECT sa.*, s.hostname FROM server_actions sa JOIN servers s ON s.id = sa.server_id ORDER BY s.hostname'
      );
      const lines = actions.map(a => `${a.hostname}: ${a.label || a.file_path} [${a.enabled ? 'HIDDEN' : 'VISIBLE'}]`);
      await sendTelegramMessage('<b>Server Actions:</b>\n' + (lines.length ? lines.join('\n') : 'No actions configured'));
      return res.sendStatus(200);
    }

    if (cmd === '/hide' || cmd === '/show') {
      const search = parts.slice(1).join(' ').toLowerCase();
      if (!search) {
        await sendTelegramMessage('Usage: /hide <server name or label>');
        return res.sendStatus(200);
      }
      const actions = await db.queryAll(
        `SELECT sa.*, s.hostname FROM server_actions sa JOIN servers s ON s.id = sa.server_id
         WHERE LOWER(s.hostname) LIKE $1 OR LOWER(sa.label) LIKE $1`, ['%' + search + '%']
      );
      if (actions.length === 0) {
        await sendTelegramMessage('No actions found for: ' + search);
        return res.sendStatus(200);
      }
      const newState = cmd === '/hide' ? 1 : 0;
      for (const a of actions) {
        await db.query('UPDATE server_actions SET enabled = $1 WHERE id = $2', [newState, a.id]);
      }
      const status = newState ? 'HIDDEN' : 'VISIBLE';
      for (const a of actions) {
        await sendTelegramMessage(`<b>${a.hostname}</b>: ${a.label || a.file_path} → ${status} (agent will apply within 1 min)`);
      }
      return res.sendStatus(200);
    }

    await sendTelegramMessage('Commands: /list /hide &lt;server&gt; /show &lt;server&gt;');
    res.sendStatus(200);
  } catch (err) {
    console.error('[Webhook]', err.message);
    res.sendStatus(200);
  }
});

module.exports = router;
