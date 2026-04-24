const dns = require('dns');
const { Pool } = require('pg');
require('dotenv').config();

dns.setDefaultResultOrder('ipv4first');

const host = process.env.PGHOST || 'db.aslmrkilqfiotlvpabbo.supabase.co';
const port = parseInt(process.env.PGPORT || '5432');
const dbName = process.env.PGDATABASE || 'postgres';
const user = process.env.PGUSER || 'postgres';
const pass = process.env.PGPASSWORD || 'M.9-7eDz,@hbwv9';

console.log(`Connecting to PostgreSQL: ${user}@${host}:${port}/${dbName}`);

const pool = new Pool({
  host,
  port,
  database: dbName,
  user,
  password: pass,
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
