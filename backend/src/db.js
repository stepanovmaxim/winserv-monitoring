const { Pool } = require('pg');
require('dotenv').config();

const connectionString = process.env.DATABASE_URL || 'postgresql://localhost:5432/postgres';
console.log('Connecting to PostgreSQL...');

const pool = new Pool({
  connectionString,
  ssl: { rejectUnauthorized: false },
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on('error', (err) => {
  console.error('PostgreSQL pool error:', err.message);
});

async function query(sql, params = [], retries = 2) {
  for (let i = 0; i <= retries; i++) {
    try {
      const client = await pool.connect();
      try {
        const result = await client.query(sql, params);
        return result;
      } finally {
        client.release();
      }
    } catch (err) {
      if (i === retries) throw err;
      console.error('DB query retry', i + 1, err.message);
      await new Promise(r => setTimeout(r, 1000));
    }
  }
}

async function queryOne(sql, params = []) {
  const result = await query(sql, params);
  return result.rows[0] || null;
}

async function queryAll(sql, params = []) {
  const result = await query(sql, params);
  return result.rows;
}

async function exec(sql) {
  await query(sql);
}

module.exports = { pool, query, queryOne, queryAll, exec };
