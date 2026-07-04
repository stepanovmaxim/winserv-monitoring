#!/usr/bin/env bash
# WinServ backend dead-man's switch.
# Runs from cron (every 2 min). If /api/health stops answering, it restarts the
# PM2 process once and pings Telegram. Sends a single alert per state change.
#
# Install on the VPS:
#   chmod +x /opt/winserv/ops/watchdog.sh
#   ( crontab -l 2>/dev/null; echo '*/2 * * * * /opt/winserv/ops/watchdog.sh' ) | crontab -
set -u

ENV_FILE=/opt/winserv/backend/.env
STATE=/tmp/winserv-watchdog.state
HEALTH_URL=http://localhost:3000/api/health

DATABASE_URL=$(grep -E '^DATABASE_URL=' "$ENV_FILE" 2>/dev/null | cut -d= -f2-)

notify() {
  local msg="$1" row token chat
  row=$(psql "$DATABASE_URL" -tAc \
    "SELECT bot_token||'|'||chat_id FROM telegram_config WHERE enabled=1 AND bot_token<>'' LIMIT 1" 2>/dev/null)
  token=${row%%|*}; chat=${row#*|}
  [ -n "$token" ] && [ -n "$chat" ] && curl -s -m 10 \
    "https://api.telegram.org/bot${token}/sendMessage" \
    -d chat_id="$chat" -d parse_mode=HTML --data-urlencode text="$msg" >/dev/null 2>&1
}

code=$(curl -s -m 10 -o /dev/null -w '%{http_code}' "$HEALTH_URL")
prev=$(cat "$STATE" 2>/dev/null || echo ok)

if [ "$code" = "200" ]; then
  [ "$prev" != "ok" ] && notify "✅ <b>WinServ backend recovered</b>"
  echo ok > "$STATE"
else
  if [ "$prev" = "ok" ]; then
    echo down > "$STATE"
    pm2 restart winserv >/dev/null 2>&1
    notify "🔴 <b>WinServ backend DOWN</b> (health=${code:-000}). Auto-restart issued."
  fi
fi
