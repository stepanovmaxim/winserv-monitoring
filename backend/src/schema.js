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

    CREATE TABLE IF NOT EXISTS customers (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      active INTEGER DEFAULT 1,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    -- Maps an AD domain suffix (e.g. semargl.pro) to a customer, so domain-joined
    -- machines inherit their owner automatically on registration.
    CREATE TABLE IF NOT EXISTS domain_customers (
      domain TEXT PRIMARY KEY,
      customer_id INTEGER REFERENCES customers(id) ON DELETE CASCADE
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
    CREATE INDEX IF NOT EXISTS idx_events_dedup ON system_events(server_id, event_id, created_at);

    CREATE TABLE IF NOT EXISTS metrics_hourly (
      server_id INTEGER REFERENCES servers(id) ON DELETE CASCADE,
      bucket TIMESTAMPTZ NOT NULL,
      cpu_avg DOUBLE PRECISION,
      cpu_max DOUBLE PRECISION,
      mem_pct_avg DOUBLE PRECISION,
      disk_pct_avg DOUBLE PRECISION,
      sample_count INTEGER,
      PRIMARY KEY (server_id, bucket)
    );

    CREATE TABLE IF NOT EXISTS action_audit (
      id SERIAL PRIMARY KEY,
      action_id INTEGER,
      server_id INTEGER,
      hostname TEXT DEFAULT '',
      label TEXT DEFAULT '',
      new_state TEXT DEFAULT '',
      source TEXT DEFAULT '',
      actor TEXT DEFAULT '',
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_audit_created ON action_audit(created_at DESC);

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
      cpu_threshold INTEGER DEFAULT 90,
      memory_threshold INTEGER DEFAULT 95,
      disk_threshold INTEGER DEFAULT 90,
      authorized_chats TEXT DEFAULT '',
      viewer_chats TEXT DEFAULT '',
      webhook_secret TEXT DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS agent_tokens (
      id SERIAL PRIMARY KEY,
      server_id INTEGER REFERENCES servers(id) ON DELETE CASCADE,
      token TEXT UNIQUE NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS alert_state (
      key TEXT PRIMARY KEY,
      active INTEGER DEFAULT 0,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    -- Planned mute windows. scope_type: global | customer | group | server.
    -- While NOW() is inside a matching window, alerts (incl. offline) are suppressed.
    CREATE TABLE IF NOT EXISTS maintenance_windows (
      id SERIAL PRIMARY KEY,
      scope_type TEXT NOT NULL CHECK(scope_type IN ('global','customer','group','server')),
      scope_id INTEGER,
      starts_at TIMESTAMPTZ NOT NULL,
      ends_at TIMESTAMPTZ NOT NULL,
      reason TEXT DEFAULT '',
      created_by TEXT DEFAULT '',
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_maint_active ON maintenance_windows(starts_at, ends_at);

    -- Online/offline transition log, for flapping detection.
    CREATE TABLE IF NOT EXISTS status_log (
      id SERIAL PRIMARY KEY,
      server_id INTEGER REFERENCES servers(id) ON DELETE CASCADE,
      status TEXT NOT NULL,
      changed_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_statuslog_server_time ON status_log(server_id, changed_at);

    -- Agentless external checks run from the backend (reachable targets only:
    -- public IPs, gateways, VPN/mail/web endpoints). kind: ping | tcp | http | tls.
    CREATE TABLE IF NOT EXISTS checks (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
      kind TEXT NOT NULL CHECK(kind IN ('ping','tcp','http','tls')),
      host TEXT NOT NULL,
      port INTEGER,
      target TEXT DEFAULT '',
      interval_sec INTEGER DEFAULT 60,
      enabled INTEGER DEFAULT 1,
      status TEXT DEFAULT 'unknown' CHECK(status IN ('up','down','unknown')),
      last_latency_ms INTEGER,
      last_checked TIMESTAMPTZ,
      last_error TEXT DEFAULT '',
      cert_expires_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS check_events (
      id SERIAL PRIMARY KEY,
      check_id INTEGER REFERENCES checks(id) ON DELETE CASCADE,
      status TEXT NOT NULL,
      latency_ms INTEGER,
      detail TEXT DEFAULT '',
      at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_check_events_time ON check_events(check_id, at DESC);

    -- One-shot control commands (reboot, restart a service). Queued here,
    -- delivered to the agent on its next check-in, executed once, reported back.
    CREATE TABLE IF NOT EXISTS server_commands (
      id SERIAL PRIMARY KEY,
      server_id INTEGER REFERENCES servers(id) ON DELETE CASCADE,
      ctype TEXT NOT NULL CHECK(ctype IN ('reboot','restart_service')),
      param TEXT DEFAULT '',
      status TEXT DEFAULT 'pending' CHECK(status IN ('pending','done','failed')),
      result TEXT DEFAULT '',
      requested_by TEXT DEFAULT '',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      executed_at TIMESTAMPTZ
    );

    CREATE INDEX IF NOT EXISTS idx_commands_pending ON server_commands(server_id, status);

    -- Security-log logons: 4625 failures (brute-force signal) and 4624 RDP successes.
    CREATE TABLE IF NOT EXISTS security_events (
      id SERIAL PRIMARY KEY,
      server_id INTEGER REFERENCES servers(id) ON DELETE CASCADE,
      event TEXT NOT NULL,
      account TEXT DEFAULT '',
      ip TEXT DEFAULT '',
      logon_type TEXT DEFAULT '',
      recorded_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_sec_server_time ON security_events(server_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_sec_ip_time ON security_events(ip, created_at);

    -- Current health snapshot per server (replaced on each agent health report).
    -- kind: service_stopped | cert_expiring | task_failed.
    CREATE TABLE IF NOT EXISTS health_items (
      id SERIAL PRIMARY KEY,
      server_id INTEGER REFERENCES servers(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      name TEXT DEFAULT '',
      detail TEXT DEFAULT '',
      expires_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_health_server ON health_items(server_id, kind);

    CREATE TABLE IF NOT EXISTS server_actions (
      id SERIAL PRIMARY KEY,
      server_id INTEGER REFERENCES servers(id) ON DELETE CASCADE,
      label TEXT NOT NULL DEFAULT '',
      file_path TEXT NOT NULL DEFAULT '',
      enabled INTEGER DEFAULT 0,
      applied INTEGER DEFAULT 1,
      logout_users INTEGER DEFAULT 1,
      allowed_chats TEXT DEFAULT '',
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    -- Central alert journal: every notification that fires (threshold, offline,
    -- flapping, service, cert, brute-force, check) is recorded here for the panel,
    -- with acknowledge/snooze state. severity: info | warning | critical.
    CREATE TABLE IF NOT EXISTS alerts (
      id SERIAL PRIMARY KEY,
      severity TEXT DEFAULT 'warning' CHECK(severity IN ('info','warning','critical')),
      kind TEXT DEFAULT '',
      server_id INTEGER REFERENCES servers(id) ON DELETE SET NULL,
      check_id INTEGER REFERENCES checks(id) ON DELETE SET NULL,
      customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
      title TEXT DEFAULT '',
      message TEXT DEFAULT '',
      acknowledged_at TIMESTAMPTZ,
      acknowledged_by TEXT DEFAULT '',
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_alerts_created ON alerts(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_alerts_unacked ON alerts(acknowledged_at, created_at DESC);
  `);

  await db.exec(`ALTER TABLE metrics ADD COLUMN IF NOT EXISTS disks_json TEXT DEFAULT '[]'`);

  await db.exec(`ALTER TABLE servers ADD COLUMN IF NOT EXISTS description TEXT DEFAULT ''`);
  await db.exec(`ALTER TABLE servers ADD COLUMN IF NOT EXISTS notify_cpu INTEGER DEFAULT 1`);
  await db.exec(`ALTER TABLE servers ADD COLUMN IF NOT EXISTS notify_memory INTEGER DEFAULT 1`);
  await db.exec(`ALTER TABLE servers ADD COLUMN IF NOT EXISTS notify_disk INTEGER DEFAULT 1`);
  await db.exec(`ALTER TABLE telegram_config ADD COLUMN IF NOT EXISTS offline_minutes INTEGER DEFAULT 3`);
  await db.exec(`ALTER TABLE telegram_config ADD COLUMN IF NOT EXISTS authorized_chats TEXT DEFAULT ''`);
  await db.exec(`ALTER TABLE telegram_config ADD COLUMN IF NOT EXISTS viewer_chats TEXT DEFAULT ''`);
  await db.exec(`ALTER TABLE telegram_config ADD COLUMN IF NOT EXISTS webhook_secret TEXT DEFAULT ''`);
  await db.exec(`ALTER TABLE telegram_config ADD COLUMN IF NOT EXISTS cpu_threshold INTEGER DEFAULT 90`);
  await db.exec(`ALTER TABLE telegram_config ADD COLUMN IF NOT EXISTS memory_threshold INTEGER DEFAULT 95`);
  await db.exec(`ALTER TABLE telegram_config ADD COLUMN IF NOT EXISTS disk_threshold INTEGER DEFAULT 90`);
  await db.exec(`ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check`);
  await db.exec(`ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('admin','viewer','pending'))`);
  await db.exec(`ALTER TABLE server_actions ADD COLUMN IF NOT EXISTS applied INTEGER DEFAULT 1`);
  await db.exec(`ALTER TABLE server_actions ADD COLUMN IF NOT EXISTS allowed_chats TEXT DEFAULT ''`);
  await db.exec(`ALTER TABLE servers ADD COLUMN IF NOT EXISTS customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL`);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_servers_customer ON servers(customer_id)`);

  // Per-entity threshold overrides (NULL = inherit: server → group → customer → global).
  for (const tbl of ['servers', 'server_groups', 'customers']) {
    await db.exec(`ALTER TABLE ${tbl} ADD COLUMN IF NOT EXISTS cpu_threshold INTEGER`);
    await db.exec(`ALTER TABLE ${tbl} ADD COLUMN IF NOT EXISTS memory_threshold INTEGER`);
    await db.exec(`ALTER TABLE ${tbl} ADD COLUMN IF NOT EXISTS disk_threshold INTEGER`);
  }

  await db.exec(`ALTER TABLE telegram_config ADD COLUMN IF NOT EXISTS digest_enabled INTEGER DEFAULT 0`);
  await db.exec(`ALTER TABLE telegram_config ADD COLUMN IF NOT EXISTS digest_hour INTEGER DEFAULT 9`);
  await db.exec(`ALTER TABLE telegram_config ADD COLUMN IF NOT EXISTS digest_last_sent DATE`);
  await db.exec(`ALTER TABLE telegram_config ADD COLUMN IF NOT EXISTS flap_threshold INTEGER DEFAULT 6`);

  // Daily hide/show schedule for a file-action (HH:MM, server local time).
  await db.exec(`ALTER TABLE server_actions ADD COLUMN IF NOT EXISTS schedule_enabled INTEGER DEFAULT 0`);
  await db.exec(`ALTER TABLE server_actions ADD COLUMN IF NOT EXISTS schedule_hide TEXT DEFAULT ''`);
  await db.exec(`ALTER TABLE server_actions ADD COLUMN IF NOT EXISTS schedule_show TEXT DEFAULT ''`);

  // Agent self-reported version, for the fleet update view.
  await db.exec(`ALTER TABLE servers ADD COLUMN IF NOT EXISTS agent_version TEXT DEFAULT ''`);
  // windows | linux — agents report it; drives the icon and the "outdated" check.
  await db.exec(`ALTER TABLE servers ADD COLUMN IF NOT EXISTS platform TEXT DEFAULT 'windows'`);

  // Deep-health fields reported by the agent.
  await db.exec(`ALTER TABLE servers ADD COLUMN IF NOT EXISTS pending_reboot INTEGER DEFAULT 0`);
  await db.exec(`ALTER TABLE servers ADD COLUMN IF NOT EXISTS health_at TIMESTAMPTZ`);

  // Optional extra alert channel (webhook — Slack/Teams/custom).
  await db.exec(`ALTER TABLE telegram_config ADD COLUMN IF NOT EXISTS alert_webhook_url TEXT DEFAULT ''`);
  await db.exec(`ALTER TABLE telegram_config ADD COLUMN IF NOT EXISTS alert_webhook_enabled INTEGER DEFAULT 0`);

  // RDP brute-force alerting.
  await db.exec(`ALTER TABLE telegram_config ADD COLUMN IF NOT EXISTS notify_bruteforce INTEGER DEFAULT 1`);
  await db.exec(`ALTER TABLE telegram_config ADD COLUMN IF NOT EXISTS bruteforce_threshold INTEGER DEFAULT 10`);

  // Health: services to ignore (NULL = use built-in defaults; edited in Settings).
  await db.exec(`ALTER TABLE telegram_config ADD COLUMN IF NOT EXISTS service_ignore TEXT`);

  // Metric scheduler interval (minutes) pushed to agents; they reschedule to it.
  await db.exec(`ALTER TABLE telegram_config ADD COLUMN IF NOT EXISTS metric_interval INTEGER DEFAULT 1`);

  // Automatic ban of brute-force / DoS source IPs. Off by default. The allowlist
  // and the built-in private/reserved guard ensure own/local networks are never
  // banned. autoban_minutes 0 = permanent (until manually unblocked).
  await db.exec(`ALTER TABLE telegram_config ADD COLUMN IF NOT EXISTS autoban_enabled INTEGER DEFAULT 0`);
  await db.exec(`ALTER TABLE telegram_config ADD COLUMN IF NOT EXISTS autoban_threshold INTEGER DEFAULT 30`);
  await db.exec(`ALTER TABLE telegram_config ADD COLUMN IF NOT EXISTS autoban_minutes INTEGER DEFAULT 1440`);
  await db.exec(`ALTER TABLE telegram_config ADD COLUMN IF NOT EXISTS autoban_allowlist TEXT DEFAULT ''`);
  // Min distinct accounts for a ban: below this it's treated as a broken client
  // (e.g. an employee's stale password), not a spray — and is never auto-banned.
  await db.exec(`ALTER TABLE telegram_config ADD COLUMN IF NOT EXISTS autoban_min_accounts INTEGER DEFAULT 3`);

  // Active/expired IP blocks (firewall rules pushed to agents). auto=1 means the
  // block was placed by the auto-ban engine; expires_at NULL = permanent.
  await db.exec(`
    CREATE TABLE IF NOT EXISTS ip_blocks (
      id SERIAL PRIMARY KEY,
      ip TEXT NOT NULL,
      server_id INTEGER REFERENCES servers(id) ON DELETE CASCADE,
      customer_id INTEGER,
      reason TEXT DEFAULT '',
      auto INTEGER DEFAULT 0,
      requested_by TEXT DEFAULT '',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      expires_at TIMESTAMPTZ,
      unblocked_at TIMESTAMPTZ
    );
  `);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_ipblocks_active ON ip_blocks(server_id, ip) WHERE unblocked_at IS NULL`);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_ipblocks_expiry ON ip_blocks(expires_at) WHERE unblocked_at IS NULL`);

  // Asset inventory: hardware snapshot (one row per server) + installed
  // software (replaced on each daily agent report).
  await db.exec(`
    CREATE TABLE IF NOT EXISTS server_hardware (
      server_id INTEGER PRIMARY KEY REFERENCES servers(id) ON DELETE CASCADE,
      manufacturer TEXT DEFAULT '',
      model TEXT DEFAULT '',
      serial TEXT DEFAULT '',
      os_caption TEXT DEFAULT '',
      os_version TEXT DEFAULT '',
      os_build TEXT DEFAULT '',
      cpu TEXT DEFAULT '',
      cpu_cores INTEGER DEFAULT 0,
      cpu_logical INTEGER DEFAULT 0,
      ram_gb DOUBLE PRECISION DEFAULT 0,
      disks_json TEXT DEFAULT '[]',
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS inventory_software (
      id SERIAL PRIMARY KEY,
      server_id INTEGER REFERENCES servers(id) ON DELETE CASCADE,
      name TEXT DEFAULT '',
      version TEXT DEFAULT '',
      publisher TEXT DEFAULT '',
      installed_on TEXT DEFAULT ''
    );

    CREATE INDEX IF NOT EXISTS idx_inv_soft_server ON inventory_software(server_id, name);
  `);
  await db.exec(`ALTER TABLE servers ADD COLUMN IF NOT EXISTS inventory_at TIMESTAMPTZ`);
  // Windows patch status (collected with inventory).
  await db.exec(`ALTER TABLE server_hardware ADD COLUMN IF NOT EXISTS last_patch_date DATE`);
  await db.exec(`ALTER TABLE server_hardware ADD COLUMN IF NOT EXISTS hotfixes_json TEXT DEFAULT '[]'`);

  // Top-processes snapshot (replaced on each agent report) — "what's loading it".
  await db.exec(`
    CREATE TABLE IF NOT EXISTS process_snapshot (
      id SERIAL PRIMARY KEY,
      server_id INTEGER REFERENCES servers(id) ON DELETE CASCADE,
      name TEXT DEFAULT '',
      pid INTEGER DEFAULT 0,
      cpu_pct DOUBLE PRECISION DEFAULT 0,
      mem_mb DOUBLE PRECISION DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_proc_server ON process_snapshot(server_id);
  `);
  await db.exec(`ALTER TABLE servers ADD COLUMN IF NOT EXISTS processes_at TIMESTAMPTZ`);

  // User-defined Event Log triggers: alert when a specific Event ID appears
  // (e.g. 6008 unexpected shutdown, 55 NTFS corruption, 7 disk bad block).
  await db.exec(`
    CREATE TABLE IF NOT EXISTS event_triggers (
      id SERIAL PRIMARY KEY,
      event_id INTEGER NOT NULL,
      log_name TEXT DEFAULT 'System',
      source_match TEXT DEFAULT '',
      label TEXT DEFAULT '',
      severity TEXT DEFAULT 'warning' CHECK(severity IN ('info','warning','critical')),
      enabled INTEGER DEFAULT 1,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  // Public per-customer status page: unguessable token + on/off toggle.
  await db.exec(`ALTER TABLE customers ADD COLUMN IF NOT EXISTS status_token TEXT`);
  await db.exec(`ALTER TABLE customers ADD COLUMN IF NOT EXISTS status_enabled INTEGER DEFAULT 0`);
  await db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_status_token ON customers(status_token) WHERE status_token IS NOT NULL`);

  // Allow the manual "block IP" command type.
  await db.exec(`ALTER TABLE server_commands DROP CONSTRAINT IF EXISTS server_commands_ctype_check`);
  await db.exec(`ALTER TABLE server_commands ADD CONSTRAINT server_commands_ctype_check CHECK (ctype IN ('reboot','restart_service','block_ip','uninstall_agent','force_update','unblock_ip'))`);

  console.log('PostgreSQL schema initialized');
}

module.exports = { initSchema };
