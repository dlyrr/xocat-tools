// ============================================================
// Express API Server
// ============================================================
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const { YT_DLP } = require('../utils/ytdlp');
const { MediaProbeError, probeMedia } = require('../services/mediaProbe');
const { createWebRouter } = require('./webRoutes');

function createAPIServer(client) {
  const app = express();
  app.use(cors());

  const limiter = rateLimit({ windowMs: 60000, max: 60, message: { error: 'Too many requests.' } });
  app.use(limiter);

  // Mounted before the JSON body parser: /web/effect takes raw image bytes and
  // parses its own body. Everything under /web needs the shared bearer secret.
  app.use('/web', createWebRouter(client));

  app.use(express.json());

  app.get('/health', (req, res) => {
    res.json({
      status: 'ok',
      uptime: process.uptime(),
      bot: client?.user?.tag || 'Not connected',
      guilds: client?.guilds?.cache?.size || 0,
      commands: client?.commands?.size || 0,
      // Lets the website tell "bot is up but the playground is not configured"
      // apart from "bot is down" without leaking the secret itself.
      webApi: !!process.env.WEB_API_SECRET?.trim(),
      timestamp: Date.now(),
    });
  });

  app.get('/stats', (req, res) => {
    const { dbGet } = require('../database/db');
    const totalCommands = dbGet('SELECT COUNT(*) as count FROM command_logs') || { count: 0 };
    const totalUsers = dbGet('SELECT COUNT(*) as count FROM user_profiles') || { count: 0 };
    const premiumUsers = dbGet('SELECT COUNT(*) as count FROM premium_users') || { count: 0 };

    res.json({
      guilds: client?.guilds?.cache?.size || 0,
      users: client?.guilds?.cache?.reduce((acc, g) => acc + g.memberCount, 0) || 0,
      commands: client?.commands?.size || 0,
      totalCommandsRun: totalCommands.count,
      totalUsers: totalUsers.count,
      premiumUsers: premiumUsers.count,
      uptime: process.uptime(),
    });
  });

  app.post('/scrape', async (req, res) => {
    const { url } = req.body || {};
    if (!url) return res.status(400).json({ error: 'URL is required in request body' });

    try {
      const media = await probeMedia(url);
      res.json({ status: 'success', media });
    } catch (error) {
      if (error instanceof MediaProbeError) {
        return res.status(error.status).json({ error: error.message, message: error.detail });
      }
      res.status(500).json({ error: 'Failed to extract media', message: error.message });
    }
  });

  // Keep the old GET route for backward compatibility with the command for now
  app.get('/api/scrape', async (req, res) => {
    // Redirect to the internal logic or just reuse it
    const { url } = req.query;
    if (!url) return res.status(400).json({ error: 'URL is required' });
    
    const { execFile } = require('child_process');

    execFile(YT_DLP, ['--dump-json', '--no-playlist', url], (error, stdout, stderr) => {
      if (error) return res.status(500).json({ error: 'Scraper failed', message: stderr });
      try {
        const data = JSON.parse(stdout);
        res.json({ status: 'success', media: { ...data, direct_link: data.url } });
      } catch (e) { res.status(500).json({ error: 'Parse failed' }); }
    });
  });

  return app;
}

module.exports = { createAPIServer };
