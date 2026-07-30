// ============================================================
// Express API Server
// ============================================================
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const { YT_DLP, USER_AGENT } = require('../utils/ytdlp');

function createAPIServer(client) {
  const app = express();
  app.use(cors());
  app.use(express.json());

  const limiter = rateLimit({ windowMs: 60000, max: 60, message: { error: 'Too many requests.' } });
  app.use(limiter);

  app.get('/health', (req, res) => {
    res.json({
      status: 'ok',
      uptime: process.uptime(),
      bot: client?.user?.tag || 'Not connected',
      guilds: client?.guilds?.cache?.size || 0,
      commands: client?.commands?.size || 0,
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
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: 'URL is required in request body' });

    const { execFile } = require('child_process');

    const args = [
      '--dump-json',
      '--no-playlist',
      '--no-warnings',
      '--format', 'bv*[height<=720]+ba/b[height<=720]/bv*+ba/b',
      '--user-agent', USER_AGENT,
      url
    ];

    execFile(YT_DLP, args, { timeout: 30000 }, (error, stdout, stderr) => {
      if (error) {
        console.error('[SCRAPE] yt-dlp error:', stderr?.slice(0, 500));
        return res.status(500).json({ error: 'Failed to extract media', message: stderr?.slice(0, 300) });
      }

      try {
        const data = JSON.parse(stdout);
        const result = {
          status: 'success',
          media: {
            url: data.webpage_url || data.url,
            direct_link: data.url,
            title: data.title || data.fulltitle,
            description: data.description,
            view_count: data.view_count,
            like_count: data.like_count,
            uploader: data.uploader || data.channel || data.creator,
            uploader_url: data.uploader_url || data.channel_url,
            thumbnail: data.thumbnail,
            duration: data.duration,
            width: data.width,
            height: data.height,
            fps: data.fps,
            filesize: data.filesize || data.filesize_approx,
            extractor: data.extractor_key || data.extractor,
            format: data.format,
          }
        };
        res.json(result);
      } catch (parseErr) {
        res.status(500).json({ error: 'Failed to parse media data', message: parseErr.message });
      }
    });
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
