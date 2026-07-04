const express = require('express');
const { requireAuth, requireAdmin, requireApproved } = require('../middleware/authMiddleware');
const db = require('../db');

const router = express.Router();

// --- Customers ---
router.get('/', requireAuth, requireApproved, async (req, res) => {
  const customers = await db.queryAll(
    `SELECT c.*,
       (SELECT COUNT(*)::int FROM servers s WHERE s.customer_id = c.id) AS server_count
     FROM customers c
     ORDER BY c.name`
  );
  res.json(customers);
});

router.post('/', requireAuth, requireAdmin, async (req, res) => {
  const { name, description } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });
  const r = await db.query(
    'INSERT INTO customers (name, description) VALUES ($1, $2) RETURNING id',
    [name, description || '']
  );
  res.json({ id: r.rows[0].id });
});

router.put('/:id', requireAuth, requireAdmin, async (req, res) => {
  const { name, description, active } = req.body;
  const c = await db.queryOne('SELECT * FROM customers WHERE id = $1', [req.params.id]);
  if (!c) return res.status(404).json({ error: 'Customer not found' });
  await db.query(
    'UPDATE customers SET name = $1, description = $2, active = $3 WHERE id = $4',
    [name || c.name, description !== undefined ? description : c.description,
     active !== undefined ? (active ? 1 : 0) : c.active, req.params.id]
  );
  res.json({ success: true });
});

router.delete('/:id', requireAuth, requireAdmin, async (req, res) => {
  await db.query('DELETE FROM customers WHERE id = $1', [req.params.id]);
  res.json({ success: true });
});

// --- Domain → customer mappings ---
router.get('/domains', requireAuth, requireApproved, async (req, res) => {
  const mappings = await db.queryAll(
    `SELECT dc.domain, dc.customer_id, c.name AS customer_name
     FROM domain_customers dc LEFT JOIN customers c ON c.id = dc.customer_id
     ORDER BY dc.domain`
  );
  // Domains seen in the fleet that aren't mapped yet, to offer in the UI.
  const seen = await db.queryAll(
    `SELECT DISTINCT lower(substring(hostname from position('.' in hostname) + 1)) AS domain
     FROM servers WHERE hostname LIKE '%.%' ORDER BY 1`
  );
  res.json({ mappings, domains: seen.map(d => d.domain) });
});

router.put('/domains', requireAuth, requireAdmin, async (req, res) => {
  const { domain, customer_id } = req.body;
  if (!domain || !customer_id) return res.status(400).json({ error: 'domain and customer_id required' });
  const d = String(domain).toLowerCase();
  await db.query(
    `INSERT INTO domain_customers (domain, customer_id) VALUES ($1, $2)
     ON CONFLICT (domain) DO UPDATE SET customer_id = $2`,
    [d, customer_id]
  );
  // Retro-apply to existing domain machines that have no owner yet.
  const r = await db.query(
    `UPDATE servers SET customer_id = $1
     WHERE customer_id IS NULL AND lower(substring(hostname from position('.' in hostname) + 1)) = $2`,
    [customer_id, d]
  );
  res.json({ success: true, applied: r.rowCount });
});

router.delete('/domains/:domain', requireAuth, requireAdmin, async (req, res) => {
  await db.query('DELETE FROM domain_customers WHERE domain = $1', [String(req.params.domain).toLowerCase()]);
  res.json({ success: true });
});

module.exports = router;
