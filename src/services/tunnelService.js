// ============================================================
// Cloudflare Tunnel supervisor
// ------------------------------------------------------------
// Gives the API server an HTTPS hostname without exposing the host's IP or
// sending the playground's shared secret over plain HTTP.
//
// Why the bot spawns the connector instead of the host running it: Pterodactyl
// panels (Wispbyte) run exactly one startup command, so there is nowhere to put
// a second long-lived process. Since we own the entry point, the bot supervises
// `cloudflared` as a child — upload the binary, set TUNNEL_TOKEN, restart. No
// panel changes, no custom startup command.
//
// The connector only makes outbound connections, so nothing has to be
// port-forwarded and the container's allocated port can stay closed to the
// world if the host allows it.
// ============================================================
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const logger = require('../utils/logger');

const BIN_DIR = path.resolve(__dirname, '../../bin');

// Official cloudflared release asset names, keyed by Node's platform string.
// Mirrors the convention in utils/ytdlp.js so bin/ stays predictable.
const BUNDLED_BINARIES = {
  win32: 'cloudflared.exe',
  linux: 'cloudflared-linux-amd64',
  darwin: 'cloudflared-darwin-amd64',
};

// Restart backoff. A tunnel that cannot start (bad token, revoked connector)
// should not spin at full speed forever.
const RESTART_DELAY_MS = 5000;
const MAX_RESTART_DELAY_MS = 5 * 60 * 1000;

function resolveCloudflaredPath() {
  const override = process.env.CLOUDFLARED_PATH?.trim();
  if (override) return override;

  const bundled = BUNDLED_BINARIES[process.platform];
  if (bundled) {
    const bundledPath = path.join(BIN_DIR, bundled);
    if (fs.existsSync(bundledPath)) return bundledPath;
  }

  // Fall back to PATH so a system package or `winget install cloudflared` works.
  return process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared';
}

/** True when the resolved path is a bundled binary we can stat. */
function cloudflaredAvailable() {
  const resolved = resolveCloudflaredPath();
  return !path.isAbsolute(resolved) || fs.existsSync(resolved);
}

/**
 * Start the tunnel connector if TUNNEL_TOKEN is configured.
 *
 * A missing token is the normal case for local development, so it logs at info
 * and returns rather than treating it as a failure.
 *
 * @returns {{stop: () => void} | null} handle, or null when not started
 */
function startTunnel() {
  const token = process.env.TUNNEL_TOKEN?.trim();
  if (!token) {
    logger.info('tunnel', 'TUNNEL_TOKEN is not set · skipping the Cloudflare tunnel');
    return null;
  }

  const binary = resolveCloudflaredPath();
  if (!cloudflaredAvailable()) {
    logger.warn('tunnel', `cloudflared was not found at ${binary}`);
    logger.info('fix', `Put the binary in bin/${BUNDLED_BINARIES[process.platform] || 'cloudflared'} or set CLOUDFLARED_PATH`);
    return null;
  }

  let child = null;
  let stopped = false;
  let delay = RESTART_DELAY_MS;
  let restartTimer = null;

  const launch = () => {
    if (stopped) return;

    // `--no-autoupdate` because the binary lives on a read-only-ish game host
    // and a self-update mid-flight would take the API down with it.
    child = spawn(binary, ['tunnel', '--no-autoupdate', 'run', '--token', token], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    child.once('spawn', () => {
      logger.success('tunnel', 'cloudflared connector started');
      // Only reset the backoff once the process has stayed up a while;
      // a token that fails immediately should keep backing off.
      setTimeout(() => {
        if (!stopped && child && !child.killed) delay = RESTART_DELAY_MS;
      }, 60000);
    });

    // cloudflared writes its own structured logs to stderr. Surface the lines
    // that matter and drop the per-connection chatter.
    const report = (chunk) => {
      for (const line of String(chunk).split(/\r?\n/)) {
        if (!line.trim()) continue;
        if (/ERR|error|failed|unauthorized/i.test(line)) logger.error('tunnel', line.slice(0, 300));
        else if (/Registered tunnel connection|connIndex/i.test(line)) continue;
        else if (/INF|Starting tunnel|Connection .* registered/i.test(line)) logger.info('tunnel', line.slice(0, 200));
      }
    };

    child.stdout.on('data', report);
    child.stderr.on('data', report);

    child.once('error', (error) => {
      logger.error('tunnel', 'Could not run cloudflared', error);
    });

    child.once('exit', (code, signal) => {
      child = null;
      if (stopped) return;
      logger.warn('tunnel', `cloudflared exited (${signal || `code ${code}`}) · retrying in ${Math.round(delay / 1000)}s`);
      restartTimer = setTimeout(launch, delay);
      delay = Math.min(delay * 2, MAX_RESTART_DELAY_MS);
    });
  };

  launch();

  return {
    stop() {
      stopped = true;
      if (restartTimer) clearTimeout(restartTimer);
      if (child) child.kill();
    },
  };
}

module.exports = { cloudflaredAvailable, resolveCloudflaredPath, startTunnel };
