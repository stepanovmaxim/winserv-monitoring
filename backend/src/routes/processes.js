const express = require('express');
const { requireAuth, requireApproved } = require('../middleware/authMiddleware');
const db = require('../db');

const REGISTRATION_KEY = process.env.REGISTRATION_KEY || 'winserv-reg-key-change-me';
const router = express.Router();

const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
const int = (v) => { const n = parseInt(v); return Number.isFinite(n) ? n : 0; };

// Agent top-processes report — replaces the stored snapshot for this server.
router.post('/', async (req, res) => {
  const { token, registration_key, hostname, processes } = req.body;

  let serverId = null;
  if (token) {
    const a = await db.queryOne('SELECT server_id FROM agent_tokens WHERE token = $1', [token]);
    if (a) serverId = a.server_id;
  }
  if (!serverId && registration_key === REGISTRATION_KEY && hostname) {
    const srv = await db.queryOne('SELECT id FROM servers WHERE hostname = $1', [hostname]);
    if (srv) serverId = srv.id;
  }
  if (!serverId) return res.status(401).json({ error: 'Valid token or registration_key required' });

  const list = (Array.isArray(processes) ? processes : [])
    .filter(p => p && p.name)
    .slice(0, 30)
    .map(p => [serverId, String(p.name).slice(0, 120), int(p.pid), num(p.cpu_pct), num(p.mem_mb)]);

  await db.query('DELETE FROM process_snapshot WHERE server_id = $1', [serverId]);
  for (const row of list) {
    await db.query('INSERT INTO process_snapshot (server_id, name, pid, cpu_pct, mem_mb) VALUES ($1,$2,$3,$4,$5)', row);
  }
  await db.query('UPDATE servers SET processes_at = NOW() WHERE id = $1', [serverId]);
  res.json({ success: true });
});

// Panel: current snapshot for one server, hottest first.
router.get('/:serverId', requireAuth, requireApproved, async (req, res) => {
  const rows = await db.queryAll(
    'SELECT name, pid, cpu_pct, mem_mb FROM process_snapshot WHERE server_id = $1 ORDER BY cpu_pct DESC, mem_mb DESC',
    [req.params.serverId]
  );
  res.json(rows);
});

module.exports = router;
