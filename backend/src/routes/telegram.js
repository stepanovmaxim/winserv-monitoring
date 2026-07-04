const express = require('express');
const { requireAuth, requireAdmin } = require('../middleware/authMiddleware');
const db = require('../db');
const { logAction } = require('../services/auditService');

const router = express.Router();
const TOKEN_MASK = '********';

const defaults = {
  bot_token: '', chat_id: '', enabled: false,
  notify_disk: true, notify_cpu: true, notify_errors: true, notify_offline: true,
  offline_minutes: 3, cpu_threshold: 90, memory_threshold: 95, disk_threshold: 90,
  authorized_chats: '', viewer_chats: '', webhook_secret: '',
};

router.get('/config', requireAuth, requireAdmin, async (req, res) => {
  const config = await db.queryOne('SELECT * FROM telegram_config LIMIT 1');
  if (!config) return res.json(defaults);
  // Never send the real bot token to the browser; expose only whether one is set.
  const safe = { ...config, bot_token_set: !!config.bot_token, bot_token: config.bot_token ? TOKEN_MASK : '' };
  res.json(safe);
});

router.put('/config', requireAuth, requireAdmin, async (req, res) => {
  const { chat_id, enabled, notify_disk, notify_cpu, notify_errors, notify_offline, offline_minutes, cpu_threshold, memory_threshold, disk_threshold, authorized_chats, viewer_chats, webhook_secret, digest_enabled, digest_hour, flap_threshold, alert_webhook_url, alert_webhook_enabled } = req.body;
  // A masked token means "unchanged" — treat it as absent so we keep the stored one.
  const bot_token = req.body.bot_token === TOKEN_MASK ? undefined : req.body.bot_token;

  const existing = await db.queryOne('SELECT * FROM telegram_config LIMIT 1');

  if (existing) {
    await db.query(
      `UPDATE telegram_config SET bot_token = $1, chat_id = $2, enabled = $3,
       notify_disk = $4, notify_cpu = $5, notify_errors = $6, notify_offline = $7, offline_minutes = $8,
       cpu_threshold = $9, memory_threshold = $10, disk_threshold = $11,
       authorized_chats = $12, viewer_chats = $13, webhook_secret = $14,
       digest_enabled = $15, digest_hour = $16, flap_threshold = $17,
       alert_webhook_url = $18, alert_webhook_enabled = $19
       WHERE id = $20`,
      [
        bot_token !== undefined ? bot_token : existing.bot_token,
        chat_id !== undefined ? chat_id : existing.chat_id,
        enabled !== undefined ? (enabled ? 1 : 0) : existing.enabled,
        notify_disk !== undefined ? (notify_disk ? 1 : 0) : existing.notify_disk,
        notify_cpu !== undefined ? (notify_cpu ? 1 : 0) : existing.notify_cpu,
        notify_errors !== undefined ? (notify_errors ? 1 : 0) : existing.notify_errors,
        notify_offline !== undefined ? (notify_offline ? 1 : 0) : existing.notify_offline,
        offline_minutes !== undefined ? parseInt(offline_minutes) || 3 : existing.offline_minutes,
        cpu_threshold !== undefined ? parseInt(cpu_threshold) || 90 : existing.cpu_threshold,
        memory_threshold !== undefined ? parseInt(memory_threshold) || 95 : existing.memory_threshold,
        disk_threshold !== undefined ? parseInt(disk_threshold) || 90 : existing.disk_threshold,
        authorized_chats !== undefined ? authorized_chats : existing.authorized_chats,
        viewer_chats !== undefined ? viewer_chats : existing.viewer_chats,
        webhook_secret !== undefined ? webhook_secret : existing.webhook_secret,
        digest_enabled !== undefined ? (digest_enabled ? 1 : 0) : existing.digest_enabled,
        digest_hour !== undefined ? parseInt(digest_hour) : existing.digest_hour,
        flap_threshold !== undefined ? parseInt(flap_threshold) || 6 : existing.flap_threshold,
        alert_webhook_url !== undefined ? alert_webhook_url : existing.alert_webhook_url,
        alert_webhook_enabled !== undefined ? (alert_webhook_enabled ? 1 : 0) : existing.alert_webhook_enabled,
        existing.id
      ]
    );
  } else {
    await db.query(
      `INSERT INTO telegram_config (bot_token, chat_id, enabled, notify_disk, notify_cpu, notify_errors, notify_offline, offline_minutes, cpu_threshold, memory_threshold, disk_threshold, authorized_chats, viewer_chats, webhook_secret, digest_enabled, digest_hour, flap_threshold, alert_webhook_url, alert_webhook_enabled)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)`,
      [bot_token || '', chat_id || '', enabled ? 1 : 0, notify_disk ? 1 : 0, notify_cpu ? 1 : 0, notify_errors ? 1 : 0, notify_offline ? 1 : 0, parseInt(offline_minutes) || 3, parseInt(cpu_threshold) || 90, parseInt(memory_threshold) || 95, parseInt(disk_threshold) || 90, authorized_chats || '', viewer_chats || '', webhook_secret || '', digest_enabled ? 1 : 0, digest_hour !== undefined ? parseInt(digest_hour) : 9, parseInt(flap_threshold) || 6, alert_webhook_url || '', alert_webhook_enabled ? 1 : 0]
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

    const callback = req.body?.callback_query;
    if (callback) {
      const chatId = String(callback.message?.chat?.id);
      const data = callback.data;
      if (!chatId || !data) return res.sendStatus(200);
      const parts = data.split('_');
      if (parts[0] === 'toggle' && parts[1]) {
        const actionId = parseInt(parts[1]);
        await db.query('UPDATE server_actions SET enabled = CASE WHEN enabled = 1 THEN 0 ELSE 1 END, applied = 0 WHERE id = $1', [actionId]);
        await answerCallback(config, callback.id, 'Toggled. Agent will apply within 1 min.');
        const a = await db.queryOne('SELECT sa.*, s.hostname FROM server_actions sa JOIN servers s ON s.id = sa.server_id WHERE sa.id = $1', [actionId]);
        if (a) {
          logAction({ action_id: a.id, server_id: a.server_id, hostname: a.hostname, label: a.label, new_state: a.enabled ? 'HIDDEN' : 'VISIBLE', source: 'telegram', actor: chatId });
          await sendBotReplyRaw(config, chatId, `<b>${a.hostname}</b>: ${a.label || a.file_path} → ${a.enabled ? 'HIDDEN' : 'VISIBLE'}`, null);
        }
      }
      if ((parts[0] === 'dohide' || parts[0] === 'doshow') && parts[1]) {
        const actionId = parseInt(parts[1]);
        const newState = parts[0] === 'dohide' ? 1 : 0;
        await db.query('UPDATE server_actions SET enabled = $1, applied = 0 WHERE id = $2', [newState, actionId]);
        await answerCallback(config, callback.id, parts[0] === 'dohide' ? 'Hiding...' : 'Showing...');
        const a = await db.queryOne('SELECT sa.*, s.hostname FROM server_actions sa JOIN servers s ON s.id = sa.server_id WHERE sa.id = $1', [actionId]);
        if (a) {
          logAction({ action_id: a.id, server_id: a.server_id, hostname: a.hostname, label: a.label, new_state: newState ? 'HIDDEN' : 'VISIBLE', source: 'telegram', actor: chatId });
          const actionLabel = a.hostname + ': ' + (a.label || a.file_path);
          const newStatus = newState ? 'HIDING' : 'SHOWING';
          await sendBotReplyRaw(config, chatId, '<b>' + actionLabel + '</b> → ' + newStatus + ' (agent applies within 1 min)', null);
        }
      }
      return res.sendStatus(200);
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
      return res.sendStatus(200);
    }

    const { sendTelegramMessage } = require('../services/telegram');
    const parts = text.split(/\s+/);
    let cmd = parts[0].toLowerCase();
    if (cmd.includes('@')) cmd = cmd.split('@')[0];

    if (cmd === '/start' || cmd === '/help') {
      const allActions = await db.queryAll('SELECT sa.*, s.hostname FROM server_actions sa JOIN servers s ON s.id = sa.server_id ORDER BY s.hostname');
      const actions = filterActionsForUser(allActions, config, chatId);

      const keyboard = { inline_keyboard: [] };
      for (const a of actions) {
        const label = `${a.hostname}: ${a.label || a.file_path}`;
        keyboard.inline_keyboard.push([{ text: `${a.enabled ? '✅' : '❌'} ${label}`, callback_data: `toggle_${a.id}` }]);
      }
      if (keyboard.inline_keyboard.length === 0) {
        keyboard.inline_keyboard.push([{ text: 'No actions available', callback_data: 'noop' }]);
      }

      await sendBotReplyRaw(config, chatId,
        (isAdmin ? '<b>WinServ Bot (Admin)</b>\n' : '<b>WinServ Bot</b>\n') +
        'Tap to toggle hide/show:\n' +
        '/help — text commands',
        keyboard
      );
      return res.sendStatus(200);
    }

    if (cmd === '/list') {
      if (!isAdmin) {
        await sendBotReply(config, chatId, '/list requires admin access.');
        return res.sendStatus(200);
      }
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
      const allActions = await db.queryAll('SELECT sa.*, s.hostname FROM server_actions sa JOIN servers s ON s.id = sa.server_id');
      const myActions = filterActionsForUser(allActions, config, chatId);
      if (myActions.length === 0) {
        await sendBotReply(config, chatId, 'No actions available or access denied.');
        return res.sendStatus(200);
      }
      const search = parts.slice(1).join(' ').toLowerCase();
      if (!search) {
        const wantHide = cmd === '/hide';
        const keyboard = { inline_keyboard: [] };
        for (const a of myActions) {
          const label = `${a.hostname}: ${a.label || a.file_path}`;
          const cbData = `${cmd === '/hide' ? 'dohide' : 'doshow'}_${a.id}`;
          keyboard.inline_keyboard.push([{ text: label, callback_data: cbData }]);
        }
        keyboard.inline_keyboard.push([{ text: '« Cancel', callback_data: 'noop' }]);
        await sendBotReplyRaw(config, chatId, 'Choose server to ' + (cmd === '/hide' ? 'hide:' : 'show:'), keyboard);
        return res.sendStatus(200);
      }
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
        logAction({ action_id: a.id, server_id: a.server_id, hostname: a.hostname, label: a.label, new_state: newState ? 'HIDDEN' : 'VISIBLE', source: 'telegram', actor: chatId });
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
    if (extra) body.reply_markup = extra;
    await nodeFetch(`https://api.telegram.org/bot${config.bot_token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {}
}

async function answerCallback(config, callbackId, text) {
  const nodeFetch = require('node-fetch');
  try {
    await nodeFetch(`https://api.telegram.org/bot${config.bot_token}/answerCallbackQuery`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ callback_query_id: callbackId, text, show_alert: false }),
    });
  } catch {}
}

function filterActionsForUser(actions, config, chatId) {
  const adminList = (config.authorized_chats || '').split(',').map(s => s.trim()).filter(Boolean);
  const viewerList = (config.viewer_chats || '').split(',').map(s => s.trim()).filter(Boolean);
  if (adminList.includes(chatId) || viewerList.includes(chatId)) return actions;
  return [];
}

module.exports = router;
