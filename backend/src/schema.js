const db = require('./db');

async function initSchema() {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      google_id TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE NOT NULL,
      name TEXT,
      avatar_url TEXT,
      role TEXT DEFAULT 'pending' CHECK(role IN ('admin','viewer','pending')),
      created_at TIMESTAMPTZ DEFAULT NOW(),
      approved_at TIMESTAMPTZ
    );

    CREATE TABLE IF NOT EXISTS server_groups (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS servers (
      id SERIAL PRIMARY KEY,
      hostname TEXT NOT NULL,
      description TEXT DEFAULT '',
      ip_address TEXT DEFAULT '',
      group_id INTEGER REFERENCES server_groups(id) ON DELETE SET NULL,
      os_info TEXT DEFAULT '',
      status TEXT DEFAULT 'unknown' CHECK(status IN ('online','offline','warning','critical')),
      notify_cpu INTEGER DEFAULT 1,
      notify_memory INTEGER DEFAULT 1,
      notify_disk INTEGER DEFAULT 1,
      last_seen TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS metrics (
      id SERIAL PRIMARY KEY,
      server_id INTEGER REFERENCES servers(id) ON DELETE CASCADE,
      cpu_usage DOUBLE PRECISION,
      memory_total_mb DOUBLE PRECISION,
      memory_used_mb DOUBLE PRECISION,
      disk_total_gb DOUBLE PRECISION,
      disk_used_gb DOUBLE PRECISION,
      disk_free_gb DOUBLE PRECISION,
      disks_json TEXT DEFAULT '[]',
      uptime_seconds BIGINT,
      collected_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_metrics_server_time ON metrics(server_id, collected_at);

    CREATE TABLE IF NOT EXISTS system_events (
      id SERIAL PRIMARY KEY,
      server_id INTEGER REFERENCES servers(id) ON DELETE CASCADE,
      event_source TEXT DEFAULT '',
      event_id INTEGER DEFAULT 0,
      level TEXT NOT NULL CHECK(level IN ('Critical','Error','Warning','Information')),
      message TEXT DEFAULT '',
      recorded_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_events_server_level ON system_events(server_id, level);

    CREATE TABLE IF NOT EXISTS telegram_config (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      bot_token TEXT DEFAULT '',
      chat_id TEXT DEFAULT '',
      enabled INTEGER DEFAULT 0,
      notify_disk INTEGER DEFAULT 1,
      notify_cpu INTEGER DEFAULT 1,
      notify_errors INTEGER DEFAULT 1,
      notify_offline INTEGER DEFAULT 1,
      offline_minutes INTEGER DEFAULT 3,
      authorized_chats TEXT DEFAULT '',
      webhook_secret TEXT DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS agent_tokens (
      id SERIAL PRIMARY KEY,
      server_id INTEGER REFERENCES servers(id) ON DELETE CASCADE,
      token TEXT UNIQUE NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS server_actions (
      id SERIAL PRIMARY KEY,
      server_id INTEGER REFERENCES servers(id) ON DELETE CASCADE,
      label TEXT NOT NULL DEFAULT '',
      file_path TEXT NOT NULL DEFAULT '',
      enabled INTEGER DEFAULT 0,
      applied INTEGER DEFAULT 1,
      logout_users INTEGER DEFAULT 1,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  await db.exec(`ALTER TABLE metrics ADD COLUMN IF NOT EXISTS disks_json TEXT DEFAULT '[]'`);

  await db.exec(`ALTER TABLE servers ADD COLUMN IF NOT EXISTS description TEXT DEFAULT ''`);
  await db.exec(`ALTER TABLE servers ADD COLUMN IF NOT EXISTS notify_cpu INTEGER DEFAULT 1`);
  await db.exec(`ALTER TABLE servers ADD COLUMN IF NOT EXISTS notify_memory INTEGER DEFAULT 1`);
  await db.exec(`ALTER TABLE servers ADD COLUMN IF NOT EXISTS notify_disk INTEGER DEFAULT 1`);
  await db.exec(`ALTER TABLE telegram_config ADD COLUMN IF NOT EXISTS offline_minutes INTEGER DEFAULT 3`);
  await db.exec(`ALTER TABLE telegram_config ADD COLUMN IF NOT EXISTS authorized_chats TEXT DEFAULT ''`);
  await db.exec(`ALTER TABLE telegram_config ADD COLUMN IF NOT EXISTS webhook_secret TEXT DEFAULT ''`);
  await db.exec(`ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check`);
  await db.exec(`ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('admin','viewer','pending'))`);
  await db.exec(`ALTER TABLE server_actions ADD COLUMN IF NOT EXISTS applied INTEGER DEFAULT 1`);

  console.log('PostgreSQL schema initialized');
}

module.exports = { initSchema };
