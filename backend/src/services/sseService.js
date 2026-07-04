// Minimal Server-Sent-Events hub. Holds the set of connected dashboard clients
// and pushes live server/metric updates so the UI reflects changes without polling.
const clients = new Set();

function addClient(res) {
  clients.add(res);
  res.on('close', () => clients.delete(res));
}

function broadcast(type, data) {
  if (clients.size === 0) return;
  const payload = `data: ${JSON.stringify({ type, ...data })}\n\n`;
  for (const res of clients) {
    try { res.write(payload); } catch { clients.delete(res); }
  }
}

function heartbeat() {
  for (const res of clients) {
    try { res.write(': ping\n\n'); } catch { clients.delete(res); }
  }
}

function clientCount() {
  return clients.size;
}

module.exports = { addClient, broadcast, heartbeat, clientCount };
