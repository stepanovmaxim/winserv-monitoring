const db = require('../db');
const nodeFetch = require('node-fetch');

async function sendTelegramMessage(text) {
  const config = await db.queryOne('SELECT * FROM telegram_config WHERE enabled = 1 LIMIT 1');
  if (!config || !config.bot_token || !config.chat_id) {
    console.log('[Telegram] Not configured or disabled');
    throw new Error('Telegram not configured');
  }

  const url = `https://api.telegram.org/bot${config.bot_token}/sendMessage`;
  try {
    const response = await nodeFetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: config.chat_id, text, parse_mode: 'HTML' }),
    });
    const data = await response.json();
    if (!data.ok) {
      console.error('[Telegram] API error:', data.description);
      throw new Error(data.description || 'Telegram API error');
    }
    console.log('[Telegram] Message sent');
    return data;
  } catch (err) {
    console.error('[Telegram] Send failed:', err.message);
    throw err;
  }
}

module.exports = { sendTelegramMessage };
