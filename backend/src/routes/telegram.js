const express = require('express');
const { requireAuth, requireAdmin } = require('../middleware/authMiddleware');
const db = require('../db');

const router = express.Router();

const defaults = {
  bot_token: '', chat_id: '', enabled: false,
  notify_disk: true, notify_cpu: true, notify_errors: true, notify_offline: true,
  offline_minutes: 3, authorized_chats: '', viewer_chats: '', webhook_secret: '',
};

router.get('/config', requireAuth, requireAdmin, async (req, res) => {
  const config = await db.queryOne('SELECT * FROM telegram_config LIMIT 1');
  res.json(config || defaults);
});

router.put('/config', requireAuth, requireAdmin, async (req, res) => {
  const { bot_token, chat_id, enabled, notify_disk, notify_cpu, notify_errors, notify_offline, offline_minutes, authorized_chats, viewer_chats, webhook_secret } = req.body;

  const existing = await db.queryOne('SELECT * FROM telegram_config LIMIT 1');

  if (existing) {
    await db.query(
      `UPDATE telegram_config SET bot_token = $1, chat_id = $2, enabled = $3,
       notify_disk = $4, notify_cpu = $5, notify_errors = $6, notify_offline = $7, offline_minutes = $8,
       authorized_chats = $9, viewer_chats = $10, webhook_secret = $11
       WHERE id = $12`,
      [
        bot_token !== undefined ? bot_token : existing.bot_token,
        chat_id !== undefined ? chat_id : existing.chat_id,
        enabled !== undefined ? (enabled ? 1 : 0) : existing.enabled,
        notify_disk !== undefined ? (notify_disk ? 1 : 0) : existing.notify_disk,
        notify_cpu !== undefined ? (notify_cpu ? 1 : 0) : existing.notify_cpu,
        notify_errors !== undefined ? (notify_errors ? 1 : 0) : existing.notify_errors,
        notify_offline !== undefined ? (notify_offline ? 1 : 0) : existing.notify_offline,
        offline_minutes !== undefined ? parseInt(offline_minutes) || 3 : existing.offline_minutes,
        authorized_chats !== undefined ? authorized_chats : existing.authorized_chats,
        viewer_chats !== undefined ? viewer_chats : existing.viewer_chats,
        webhook_secret !== undefined ? webhook_secret : existing.webhook_secret,
        existing.id
      ]
    );
  } else {
    await db.query(
      `INSERT INTO telegram_config (bot_token, chat_id, enabled, notify_disk, notify_cpu, notify_errors, notify_offline, offline_minutes, authorized_chats, viewer_chats, webhook_secret)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [bot_token || '', chat_id || '', enabled ? 1 : 0, notify_disk ? 1 : 0, notify_cpu ? 1 : 0, notify_errors ? 1 : 0, notify_offline ? 1 : 0, parseInt(offline_minutes) || 3, authorized_chats || '', viewer_chats || '', webhook_secret || '']
    );
  }

  res.json({ success: true });

  if (bot_token && bot_token.includes(':')) {
    const nodeFetch = require('node-fetch');
    const publicUrl = process.env.PUBLIC_URL || ('http://localhost:' + (process.env.PORT || '3000'));
    const webhookUrl = publicUrl.replace(/\/$/, '') + '/api/telegram/webhook';
    const secret = webhook_secret || '';
    const params = 'url=' + encodeURIComponent(webhookUrl) + (secret ? '&secret_token=' + encodeURIComponent(secret) : '');
    nodeFetch('https://api.telegram.org/bot' + bot_token + '/setWebhook?' + params)
      .then(r => r.json()).then(d => console.log('[Webhook]', d.description || 'registered:', webhookUrl))
      .catch(() => {});
    const commands = [
      { command: 'list', description: 'Show all server actions' },
      { command: 'hide', description: 'Hide file on server' },
      { command: 'show', description: 'Restore file on server' },
      { command: 'help', description: 'Bot commands help' },
    ];
    nodeFetch('https://api.telegram.org/bot' + bot_token + '/setMyCommands', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ commands }),
    }).catch(() => {});
  }
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
    const config = await db.queryOne('SELECT * FROM telegram_config WHERE enabled = 1 LIMIT 1');
    if (!config) return res.sendStatus(200);

    if (config.webhook_secret) {
      const token = req.headers['x-telegram-bot-api-secret-token'];
      if (token !== config.webhook_secret) return res.sendStatus(403);
    }

    const msg = req.body?.message || req.body?.callback_query?.message;
    if (!msg) return res.sendStatus(200);
    const text = (msg.text || '').trim();
    const chatId = String(msg.chat?.id);
    if (!chatId || !text) return res.sendStatus(200);

    const authorized = (config.authorized_chats || '').split(',').map(s => s.trim()).filter(Boolean);
    const viewers = (config.viewer_chats || '').split(',').map(s => s.trim()).filter(Boolean);
    const isAdmin = authorized.includes(chatId);
    const isViewer = viewers.includes(chatId);

    if (!isAdmin && !isViewer) {
      await sendBotReply(config, chatId, 'Access denied.');
      return res.sendStatus(200);
    }

    const { sendTelegramMessage } = require('../services/telegram');
    const parts = text.split(/\s+/);
    const cmd = parts[0].toLowerCase();

    if (cmd === '/start' || cmd === '/help') {
      const menu = {
        keyboard: [[{ text: '/list' }, { text: '/help' }]],
        resize_keyboard: true,
        one_time_keyboard: false,
      };
      await sendBotReplyRaw(config, chatId,
        (isAdmin
          ? '<b>WinServ Bot (Admin)</b>\n/list — show all actions\n'
          : '<b>WinServ Bot</b>\n'
        ) +
        '/hide &lt;name&gt; — hide file on server\n' +
        '/show &lt;name&gt; — restore file on server\n' +
        '/help — this menu',
        menu
      );
      return res.sendStatus(200);
    }

    if (cmd === '/list') {
      if (!isAdmin) {
        await sendBotReply(config, chatId, '/list requires admin access.');
        return res.sendStatus(200);
      }
      const actions = await db.queryAll(
        'SELECT sa.*, s.hostname FROM server_actions sa JOIN servers s ON s.id = sa.server_id ORDER BY s.hostname'
      );
      const lines = actions.map(a => `${a.hostname}: ${a.label || a.file_path} [${a.enabled ? 'HIDDEN' : 'VISIBLE'}]`);
      await sendBotReply(config, chatId, '<b>Actions:</b>\n' + (lines.length ? lines.join('\n') : 'No actions configured'));
      return res.sendStatus(200);
    }

    if (cmd === '/hide' || cmd === '/show') {
      if (!isAdmin && !isViewer) {
        await sendBotReply(config, chatId, 'This command requires access.');
        return res.sendStatus(200);
      }
      const search = parts.slice(1).join(' ').toLowerCase();
      if (!search) {
        await sendBotReply(config, chatId, 'Usage: ' + cmd + ' &lt;server name or label&gt;');
        return res.sendStatus(200);
      }
      const actions = await db.queryAll(
        `SELECT sa.*, s.hostname FROM server_actions sa JOIN servers s ON s.id = sa.server_id
         WHERE LOWER(s.hostname) LIKE $1 OR LOWER(sa.label) LIKE $1`, ['%' + search + '%']
      );
      if (actions.length === 0) {
        await sendBotReply(config, chatId, 'No actions found for: ' + search);
        return res.sendStatus(200);
      }
      const newState = cmd === '/hide' ? 1 : 0;
      for (const a of actions) {
        await db.query('UPDATE server_actions SET enabled = $1, applied = 0 WHERE id = $2', [newState, a.id]);
      }
      const status = newState ? 'HIDDEN' : 'VISIBLE';
      let reply = '';
      for (const a of actions) {
        reply += `<b>${a.hostname}</b>: ${a.label || a.file_path} → ${status}\n`;
      }
      reply += 'Agent will apply within 1 minute.';
      await sendBotReply(config, chatId, reply);
      return res.sendStatus(200);
    }

    await sendBotReply(config, chatId, 'Unknown command. /help for list.');
    res.sendStatus(200);
  } catch (err) {
    console.error('[Webhook]', err.message);
    res.sendStatus(200);
  }
});

async function sendBotReply(config, chatId, text) {
  return sendBotReplyRaw(config, chatId, text, null);
}

async function sendBotReplyRaw(config, chatId, text, extra) {
  const nodeFetch = require('node-fetch');
  try {
    const body = { chat_id: chatId, text, parse_mode: 'HTML' };
    if (extra) body.reply_markup = JSON.stringify(extra);
    await nodeFetch(`https://api.telegram.org/bot${config.bot_token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {}
}

module.exports = router;
