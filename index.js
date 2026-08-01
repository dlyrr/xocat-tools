// ============================================================
// Main Entry Point — Bot + API Server
// ============================================================
require('dotenv').config();

const { createClient } = require('./src/bot/client');
const { createAPIServer } = require('./src/api/server');
const { initDatabase, dbAll, dbRun } = require('./src/database/db');
const { startRobloxUpdateWatcher } = require('./src/services/robloxUpdateService');
const { startTunnel } = require('./src/services/tunnelService');
const logger = require('./src/utils/logger');

function resolveAPIPort() {
  // Pterodactyl hosts (Wispbyte) hand the container its allocated port as
  // SERVER_PORT. Prefer an explicit API_PORT, then the host's allocation.
  const raw = process.env.API_PORT || process.env.SERVER_PORT || '3001';
  const port = Number.parseInt(raw, 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('API_PORT must be a number between 1 and 65535.');
  }
  return port;
}

function startAPIServer(client, port) {
  const app = createAPIServer(client);

  return new Promise((resolve, reject) => {
    const server = app.listen(port);

    const handleStartupError = (error) => {
      if (error.code === 'EADDRINUSE') {
        logger.warn('api', `Port ${port} is already in use · refusing to start a duplicate Discord session`);
        logger.info('fix', `Close the other process or set API_PORT=${port + 1} in .env`);
        return resolve(null);
      }
      reject(error);
    };

    server.once('error', handleStartupError);
    server.once('listening', () => {
      server.removeListener('error', handleStartupError);
      server.on('error', error => logger.error('api', 'HTTP server error', error));
      logger.success('api', `Listening on http://localhost:${port}`);
      resolve(server);
    });
  });
}

async function main() {
  logger.banner();
  logger.info('boot', `Node ${process.version} · ${process.platform} · PID ${process.pid}`);

  if (!process.env.DISCORD_TOKEN) {
    logger.error('fatal', 'DISCORD_TOKEN is not set in .env');
    process.exitCode = 1;
    return;
  }

  await initDatabase();
  const client = createClient();
  const apiServer = await startAPIServer(client, resolveAPIPort());
  if (!apiServer) {
    logger.warn('boot', 'Another bot instance already owns the configured API port · exiting before Discord login');
    process.exit(0);
    return;
  }

  // Started after the API is listening so the connector never advertises a
  // hostname that would 502, and before the Discord login so a slow gateway
  // handshake does not delay the tunnel coming up.
  const tunnel = startTunnel();
  if (tunnel) {
    for (const signal of ['SIGINT', 'SIGTERM']) {
      process.once(signal, () => tunnel.stop());
    }
  }

  logger.info('discord', 'Authenticating with Discord gateway…');
  await client.login(process.env.DISCORD_TOKEN);

  // WEAO Roblox update watcher — announces new client versions to every
  // channel subscribed with /robloxupdates.
  startRobloxUpdateWatcher(client);

  // Timer check loop — check for due timers every 10 seconds
  setInterval(async () => {
    const dueTimers = dbAll('SELECT * FROM timers WHERE remind_at <= ?', [Date.now()]);

    for (const timer of dueTimers) {
      try {
        const channel = client.channels.cache.get(timer.channel_id)
          || await client.channels.fetch(timer.channel_id).catch(() => null);
        if (!channel) {
          logger.warn('timer', `Could not find channel ${timer.channel_id}; reminder ${timer.id} will be retried`);
          continue;
        }

        await channel.send({
          content: `<@${timer.user_id}> **Reminder:** ${timer.message}`,
        });
        dbRun('DELETE FROM timers WHERE id = ?', [timer.id]);
      } catch (error) {
        logger.error('timer', `Could not deliver reminder ${timer.id}; it will be retried`, error);
      }
    }
  }, 10000);
}

main().catch(error => {
  logger.error('fatal', 'Bot startup failed', error);
  process.exit(1);
});
