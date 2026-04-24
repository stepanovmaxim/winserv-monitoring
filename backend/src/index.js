require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const express = require('express');
const cors = require('cors');
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

const app = express();
const PORT = process.env.PORT || 3000;

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'Stepanov.maxim@gmail.com';

async function start() {
  await initSchema();

  const adminExists = await db.queryOne('SELECT id FROM users WHERE email = $1', [ADMIN_EMAIL]);
  if (!adminExists) {
    await db.query(
      "INSERT INTO users (google_id, email, name, role) VALUES ($1, $2, $3, 'admin') ON CONFLICT DO NOTHING",
      ['admin-pre-seed', ADMIN_EMAIL, 'Maxim Stepanov']
    );
  }

  app.use(cors({
    origin: process.env.FRONTEND_URL || 'http://localhost:5173',
    credentials: true,
  }));
  app.use(express.json({ limit: '5mb' }));
  app.use(passport.initialize());

  app.use('/api/auth', authRoutes);
  app.use('/api/servers', serverRoutes);
  app.use('/api/groups', groupRoutes);
  app.use('/api/metrics', metricsRoutes);
  app.use('/api/events', eventsRoutes);
  app.use('/api/telegram', telegramRoutes);
  app.use('/api/agent', agentRoutes);

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

  app.listen(PORT, () => {
    console.log(`WinServ Monitoring API running on port ${PORT}`);
  });
}

start().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
