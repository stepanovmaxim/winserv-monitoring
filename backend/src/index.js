require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const fs = require('fs');
const { passport } = require('./auth');
const { initSchema } = require('./schema');
const db = require('./db');

const authRoutes = require('./routes/auth');
const serverRoutes = require('./routes/servers');
const groupRoutes = require('./routes/groups');
const metricsRoutes = require('./routes/metrics');
const eventsRoutes = require('./routes/events');
const telegramRoutes = require('./routes/telegram');
const agentRoutes = require('./routes/agent');
const deployRoutes = require('./routes/deploy');
const actionRoutes = require('./routes/actions');
const customerRoutes = require('./routes/customers');
const maintenanceRoutes = require('./routes/maintenance');
const commandRoutes = require('./routes/commands');
const reportRoutes = require('./routes/reports');
const securityRoutes = require('./routes/security');
const healthReportRoutes = require('./routes/health');
const checkRoutes = require('./routes/checks');
const alertRoutes = require('./routes/alerts');
const streamRoutes = require('./routes/stream');
const { checkOfflineServers, loadAlertState } = require('./services/alertService');
const { purgeOldData } = require('./services/retentionService');
const { rollupMetrics } = require('./services/rollupService');
const { heartbeat } = require('./services/sseService');
const { maybeSendDigest } = require('./services/digestService');
const { runScheduledActions } = require('./services/scheduleService');
const { runDueChecks } = require('./services/checkService');

const app = express();
app.set('trust proxy', 1);
const PORT = process.env.PORT || 3000;

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'Stepanov.maxim@gmail.com';

// A dropped/aborted client connection is normal here (remote agents over a
// tunnel), not a server fault. Recognise those so we never treat them as fatal.
function isClientDisconnect(err) {
  if (!err) return false;
  return err.type === 'request.aborted'
    || err.code === 'ECONNRESET'
    || err.code === 'ECONNABORTED'
    || err.message === 'request aborted';
}

async function start() {
  await initSchema();
  await loadAlertState();

  const adminExists = await db.queryOne('SELECT id FROM users WHERE email = $1', [ADMIN_EMAIL]);
  if (!adminExists) {
    await db.query(
      "INSERT INTO users (google_id, email, name, role) VALUES ($1, $2, $3, 'admin') ON CONFLICT DO NOTHING",
      ['admin-pre-seed', ADMIN_EMAIL, 'Maxim Stepanov']
    );
  }

  app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
  }));
  app.use(cors({
    origin: process.env.FRONTEND_URL || 'http://localhost:5173',
    credentials: true,
  }));
  app.use(express.json({ limit: '5mb' }));

  const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 30, message: { error: 'Too many attempts' } });
  app.use('/api/auth', authLimiter);

  app.use(passport.initialize());

  app.use('/api/auth', authRoutes);
  app.use('/api/servers', serverRoutes);
  app.use('/api/groups', groupRoutes);
  app.use('/api/metrics', metricsRoutes);
  app.use('/api/events', eventsRoutes);
  app.use('/api/telegram', telegramRoutes);
  app.use('/api/agent', agentRoutes);
  app.use('/api/deploy', deployRoutes);
  app.use('/api/actions', actionRoutes);
  app.use('/api/customers', customerRoutes);
  app.use('/api/maintenance', maintenanceRoutes);
  app.use('/api/commands', commandRoutes);
  app.use('/api/reports', reportRoutes);
  app.use('/api/security', securityRoutes);
  app.use('/api/health-report', healthReportRoutes);
  app.use('/api/checks', checkRoutes);
  app.use('/api/alerts', alertRoutes);
  app.use('/api/stream', streamRoutes);

  app.get('/api/health', async (req, res) => {
    try {
      await db.queryOne('SELECT 1');
      res.json({ status: 'ok', db: 'connected', timestamp: new Date().toISOString() });
    } catch {
      res.json({ status: 'ok', db: 'disconnected', timestamp: new Date().toISOString() });
    }
  });

  const frontendDist = path.join(__dirname, '..', '..', 'frontend', 'dist');
  if (fs.existsSync(frontendDist)) {
    app.use(express.static(frontendDist));
    app.get('*', (req, res) => {
      if (!req.path.startsWith('/api')) {
        res.sendFile(path.join(frontendDist, 'index.html'));
      }
    });
  }

  // Error handler. Agents on flaky links (Cloudflare Tunnel) frequently abort
  // mid-request; body-parser turns that into a BadRequestError. Swallow client
  // disconnects quietly, respond 500 for everything else — never crash.
  app.use((err, req, res, next) => {
    if (isClientDisconnect(err)) return;
    console.error('Route error:', err.message);
    if (res.headersSent) return;
    res.status(err.status || 500).json({ error: 'Internal server error' });
  });

  app.listen(PORT, () => {
    console.log(`WinServ Monitoring API running on port ${PORT}`);
  });

  setInterval(checkOfflineServers, 30000);

  // Prune old metrics/events shortly after boot, then once a day.
  setTimeout(purgeOldData, 60000);
  setInterval(purgeOldData, 24 * 60 * 60 * 1000);

  // Roll minute metrics into hourly buckets shortly after boot, then hourly.
  setTimeout(rollupMetrics, 90000);
  setInterval(rollupMetrics, 60 * 60 * 1000);

  // Keep SSE connections alive through nginx/Cloudflare idle timeouts.
  setInterval(heartbeat, 25000);

  // Daily digest: check twice an hour; an atomic claim guards against double-send.
  setInterval(maybeSendDigest, 30 * 60 * 1000);

  // Scheduled hide/show — every 30s so each target minute is hit at least once.
  setInterval(runScheduledActions, 30 * 1000);

  // Agentless external checks (ping/tcp/http/tls) — tick every 15s; each check
  // respects its own interval.
  setInterval(runDueChecks, 15 * 1000);
}

// Last-resort guards. Only benign client disconnects are swallowed; any other
// uncaught error still exits so PM2 restarts on a genuinely broken state.
process.on('uncaughtException', (err) => {
  if (isClientDisconnect(err)) {
    console.warn('Ignored client disconnect:', err.message);
    return;
  }
  console.error('Uncaught exception:', err);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection:', reason);
});

start().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
