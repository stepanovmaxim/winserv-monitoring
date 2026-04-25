const express = require('express');
const db = require('../db');
const { v4: uuidv4 } = require('uuid');

const REGISTRATION_KEY = process.env.REGISTRATION_KEY || 'winserv-reg-key-change-me';
const router = express.Router();

router.post('/', async (req, res) => {
  const { token, registration_key, hostname } = req.body;
  let { events } = req.body;
  const h = hostname || req.body.host || '';

  if (typeof events === 'string') {
    try { events = JSON.parse(events); } catch { events = []; }
  }
  if (!Array.isArray(events)) {
    events = [];
  }

  if (events.length === 0) {
    return res.json({ success: true, count: 0 });
  }

  let serverId = null;

  if (token) {
    const agentRecord = await db.queryOne('SELECT * FROM agent_tokens WHERE token = $1', [token]);
    if (agentRecord) serverId = agentRecord.server_id;
  }

  if (!serverId && registration_key === REGISTRATION_KEY && h) {
    let server = await db.queryOne('SELECT * FROM servers WHERE hostname = $1', [h]);
    if (!server) {
      const result = await db.query(
        'INSERT INTO servers (hostname, status) VALUES ($1, $2) RETURNING id',
        [h, 'online']
      );
      server = { id: result.rows[0].id };
      const newToken = uuidv4();
      await db.query('INSERT INTO agent_tokens (server_id, token) VALUES ($1, $2) ON CONFLICT DO NOTHING', [server.id, newToken]);
    }
    serverId = server.id;
  }

  if (!serverId) {
    return res.status(401).json({ error: 'Valid token or registration_key required' });
  }

  if (h && h.includes('.')) {
    const server = await db.queryOne('SELECT group_id FROM servers WHERE id = $1', [serverId]);
    if (server && !server.group_id) {
      const domain = h.substring(h.indexOf('.') + 1);
      let group = await db.queryOne('SELECT id FROM server_groups WHERE name = $1', [domain]);
      if (!group) {
        const gr = await db.query(
          'INSERT INTO server_groups (name, description) VALUES ($1, $2) RETURNING id',
          [domain, 'Auto-created: servers in ' + domain]
        );
        group = gr.rows[0];
      }
      await db.query('UPDATE servers SET group_id = $1 WHERE id = $2 AND group_id IS NULL', [group.id, serverId]);
    }
  }

  for (const ev of events) {
    await db.query(
      `INSERT INTO system_events (server_id, event_source, event_id, level, message, recorded_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [serverId, ev.source || '', ev.event_id || 0, ev.level || 'Error', ev.message || '', ev.recorded_at || null]
    );
  }

  res.json({ success: true, count: events.length });
});

router.get('/:serverId', async (req, res) => {
  const { serverId } = req.params;
  const { level, limit } = req.query;

  let q = 'SELECT * FROM system_events WHERE server_id = $1';
  const params = [serverId];
  let paramIdx = 2;

  if (level) {
    q += ` AND level = $${paramIdx}`;
    params.push(level);
    paramIdx++;
  }

  q += ' ORDER BY created_at DESC';

  if (limit) {
    q += ` LIMIT $${paramIdx}`;
    params.push(parseInt(limit));
  }

  const events = await db.queryAll(q, params);
  res.json(events);
});

module.exports = router;
