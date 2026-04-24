const express = require('express');
const { requireAuth, requireAdmin, requireApproved } = require('../middleware/authMiddleware');
const db = require('../db');

const router = express.Router();

router.get('/', requireAuth, requireApproved, async (req, res) => {
  const groups = await db.queryAll(
    `SELECT g.*, COUNT(s.id)::int as server_count
     FROM server_groups g
     LEFT JOIN servers s ON s.group_id = g.id
     GROUP BY g.id
     ORDER BY g.name`
  );
  res.json(groups);
});

router.post('/', requireAuth, requireAdmin, async (req, res) => {
  const { name, description } = req.body;
  if (!name) return res.status(400).json({ error: 'Name is required' });
  const result = await db.query(
    'INSERT INTO server_groups (name, description) VALUES ($1, $2) RETURNING id',
    [name, description || '']
  );
  res.json({ id: result.rows[0].id, name, description });
});

router.put('/:id', requireAuth, requireAdmin, async (req, res) => {
  const { name, description } = req.body;
  const group = await db.queryOne('SELECT * FROM server_groups WHERE id = $1', [req.params.id]);
  if (!group) return res.status(404).json({ error: 'Group not found' });
  await db.query(
    'UPDATE server_groups SET name = $1, description = $2 WHERE id = $3',
    [name || group.name, description !== undefined ? description : group.description, req.params.id]
  );
  res.json({ success: true });
});

router.delete('/:id', requireAuth, requireAdmin, async (req, res) => {
  await db.query('DELETE FROM server_groups WHERE id = $1', [req.params.id]);
  res.json({ success: true });
});

module.exports = router;
