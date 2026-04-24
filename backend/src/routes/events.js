const express = require('express');
const db = require('../db');

const router = express.Router();

router.post('/', async (req, res) => {
  const { token, events } = req.body;

  if (!token) return res.status(401).json({ error: 'Agent token required' });

  const agentRecord = await db.queryOne('SELECT * FROM agent_tokens WHERE token = $1', [token]);
  if (!agentRecord) return res.status(401).json({ error: 'Invalid agent token' });

  if (!events || !Array.isArray(events)) {
    return res.status(400).json({ error: 'events array required' });
  }

  for (const ev of events) {
    await db.query(
      `INSERT INTO system_events (server_id, event_source, event_id, level, message, recorded_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        agentRecord.server_id,
        ev.source || '',
        ev.event_id || 0,
        ev.level || 'Error',
        ev.message || '',
        ev.recorded_at || null
      ]
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
