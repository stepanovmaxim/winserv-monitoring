const db = require('../db');

async function sendTelegramMessage(text) {
  const config = await db.queryOne('SELECT * FROM telegram_config WHERE enabled = 1 LIMIT 1');
  if (!config || !config.bot_token || !config.chat_id) {
    throw new Error('Telegram not configured');
  }

  const url = `https://api.telegram.org/bot${config.bot_token}/sendMessage`;
  const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));
  const f = require('node-fetch');
  const response = await f(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: config.chat_id, text, parse_mode: 'HTML' }),
  });

  const data = await response.json();
  if (!data.ok) {
    throw new Error(data.description || 'Telegram API error');
  }
  return data;
}

module.exports = { sendTelegramMessage };
