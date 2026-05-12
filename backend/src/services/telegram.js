const db = require('../db');
const nodeFetch = require('node-fetch');

const queue = [];
let processing = false;
const RATE_MS = 2500;

async function processQueue() {
  if (processing || queue.length === 0) return;
  processing = true;
  const { text, resolve, reject } = queue.shift();

  try {
    const config = await db.queryOne('SELECT * FROM telegram_config WHERE enabled = 1 LIMIT 1');
    if (!config || !config.bot_token || !config.chat_id) throw new Error('Telegram not configured');

    const url = `https://api.telegram.org/bot${config.bot_token}/sendMessage`;
    const response = await nodeFetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: config.chat_id, text, parse_mode: 'HTML', disable_notification: false }),
    });
    const data = await response.json();
    if (!data.ok) {
      if (data.description && data.description.includes('retry after')) {
        const wait = (parseInt(data.parameters?.retry_after) || 5) * 1000 + 1000;
        console.log(`[Telegram] Rate limited, waiting ${wait}ms`);
        await new Promise(r => setTimeout(r, wait));
      }
      console.error('[Telegram] API error:', data.description);
      throw new Error(data.description || 'Telegram API error');
    }
    console.log('[Telegram] Message sent');
    resolve(data);
  } catch (err) {
    console.error('[Telegram] Send failed:', err.message);
    reject(err);
  } finally {
    processing = false;
    setTimeout(processQueue, RATE_MS);
  }
}

function sendTelegramMessage(text) {
  return new Promise((resolve, reject) => {
    queue.push({ text, resolve, reject });
    processQueue();
  });
}

module.exports = { sendTelegramMessage };
