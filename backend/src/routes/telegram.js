const express = require('express');
const { requireAuth, requireAdmin } = require('../middleware/authMiddleware');
const db = require('../db');

const router = express.Router();

router.get('/config', requireAuth, requireAdmin, async (req, res) => {
  const config = await db.queryOne('SELECT * FROM telegram_config LIMIT 1');
  res.json(config || { bot_token: '', chat_id: '', enabled: false, notify_disk: true, notify_cpu: true, notify_errors: true, notify_offline: true });
});

router.put('/config', requireAuth, requireAdmin, async (req, res) => {
  const { bot_token, chat_id, enabled, notify_disk, notify_cpu, notify_errors, notify_offline } = req.body;

  const existing = await db.queryOne('SELECT * FROM telegram_config LIMIT 1');

  if (existing) {
    await db.query(
      `UPDATE telegram_config SET bot_token = $1, chat_id = $2, enabled = $3,
       notify_disk = $4, notify_cpu = $5, notify_errors = $6, notify_offline = $7
       WHERE id = $8`,
      [
        bot_token !== undefined ? bot_token : existing.bot_token,
        chat_id !== undefined ? chat_id : existing.chat_id,
        enabled !== undefined ? (enabled ? 1 : 0) : existing.enabled,
        notify_disk !== undefined ? (notify_disk ? 1 : 0) : existing.notify_disk,
        notify_cpu !== undefined ? (notify_cpu ? 1 : 0) : existing.notify_cpu,
        notify_errors !== undefined ? (notify_errors ? 1 : 0) : existing.notify_errors,
        notify_offline !== undefined ? (notify_offline ? 1 : 0) : existing.notify_offline,
        existing.id
      ]
    );
  } else {
    await db.query(
      `INSERT INTO telegram_config (bot_token, chat_id, enabled, notify_disk, notify_cpu, notify_errors, notify_offline)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [bot_token || '', chat_id || '', enabled ? 1 : 0, notify_disk ? 1 : 0, notify_cpu ? 1 : 0, notify_errors ? 1 : 0, notify_offline ? 1 : 0]
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

module.exports = router;
