const { Pool } = require('pg');
require('dotenv').config();

const connectionString = process.env.DATABASE_URL || 'postgresql://localhost:5432/postgres';
console.log('Connecting to PostgreSQL...');

const pool = new Pool({
  connectionString,
  ssl: { rejectUnauthorized: false },
  max: 10,
  idleTimeoutMillis: 30000,
});

pool.on('error', (err) => {
  console.error('PostgreSQL pool error:', err.message);
});

async function query(sql, params = []) {
  const client = await pool.connect();
  try {
    const result = await client.query(sql, params);
    return result;
  } finally {
    client.release();
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
