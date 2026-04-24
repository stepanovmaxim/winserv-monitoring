const dns = require('dns');
const { Pool } = require('pg');
require('dotenv').config();

dns.setDefaultResultOrder('ipv4first');

const pool = new Pool({
  host: process.env.PGHOST || 'aws-0-eu-central-1.pooler.supabase.com',
  port: parseInt(process.env.PGPORT || '6543'),
  database: process.env.PGDATABASE || 'postgres',
  user: process.env.PGUSER || 'postgres.aslmrkilqfiotlvpabbo',
  password: process.env.PGPASSWORD || 'M.9-7eDz,@hbwv9',
  ssl: { rejectUnauthorized: false },
  family: 4,
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
