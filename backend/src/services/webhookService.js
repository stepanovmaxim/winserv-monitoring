const db = require('../db');
const nodeFetch = require('node-fetch');

// Optional extra alert channel. Posts a plain-text JSON body ({text}) that
// Slack / Teams / custom incoming webhooks understand. HTML tags used for the
// Telegram formatting are stripped.
async function sendWebhookAlert(text) {
  try {
    const c = await db.queryOne('SELECT alert_webhook_url, alert_webhook_enabled FROM telegram_config WHERE enabled = 1 LIMIT 1');
    if (!c || !c.alert_webhook_enabled || !c.alert_webhook_url) return;
    await nodeFetch(c.alert_webhook_url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: String(text).replace(/<[^>]+>/g, '') }),
    });
  } catch (err) {
    console.error('[Webhook alert]', err.message);
  }
}

module.exports = { sendWebhookAlert };
