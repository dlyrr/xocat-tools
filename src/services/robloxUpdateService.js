// ============================================================
// Roblox Update Watcher — WEAO version tracker (docs.weao.xyz)
// ============================================================
// Polls the WEAO version endpoints and announces every new client
// version to the channels servers subscribed with /robloxupdates.
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const axios = require('axios');
const { dbAll, dbGet, dbRun } = require('../database/db');
const logger = require('../utils/logger');

const WEAO_HEADERS = { 'User-Agent': 'WEAO-3PService' };
const WEAO_BASE = 'https://weao.xyz/api/versions';
const WEAO_ICON = 'https://cdn.discordapp.com/emojis/1502955460163010561.png';
const POLL_INTERVAL_MS = 60_000;

// The live channel tracks every platform; future deployments only ship for
// desktop, so WEAO only exposes Windows/Mac there.
const PLATFORMS = {
  live: ['Windows', 'Mac', 'Android', 'iOS'],
  future: ['Windows', 'Mac'],
};

const KINDS = {
  live: {
    endpoint: `${WEAO_BASE}/current`,
    title: 'A Roblox update has been detected!',
    description: 'This is a live update, Roblox exploits are patched.',
    color: 0xE2231A,
    showVersion: false,
  },
  future: {
    endpoint: `${WEAO_BASE}/future`,
    title: 'A future Roblox update has been detected!',
    description: 'This is a future update, no need to worry about Roblox exploits being patched yet.',
    color: 0xF59E0B,
    showVersion: true,
  },
};

const PLATFORM_LABELS = { Windows: 'Windows', Mac: 'Mac', Android: 'Android', iOS: 'iOS' };

function downloadUrl(platform, hash) {
  if (!hash || !hash.startsWith('version-')) return null;
  if (platform === 'Windows') return `https://setup.rbxcdn.com/${hash}-RobloxPlayerInstaller.exe`;
  if (platform === 'Mac') return `https://setup.rbxcdn.com/mac/${hash}-RobloxPlayer.zip`;
  return null; // Mobile builds ship through the app stores, not the setup CDN.
}

/**
 * WEAO reports dates as "7/28/2026, 4:00:28 PM UTC" and mirrors them as a unix
 * timestamp inside the *Response object. Prefer the timestamp when present.
 */
function resolveTimestamp(dateString, response) {
  if (response && Number.isFinite(response.timestamp)) return response.timestamp;
  const parsed = Date.parse(String(dateString || '').replace(' UTC', ' GMT'));
  return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : Math.floor(Date.now() / 1000);
}

/**
 * Normalise one platform out of a WEAO version payload.
 */
function readPlatform(payload, platform) {
  const hash = payload?.[platform];
  if (!hash) return null;
  const response = payload[`${platform}Response`] || null;
  return {
    platform,
    hash,
    version: response?.version || null,
    timestamp: resolveTimestamp(payload[`${platform}Date`], response),
  };
}

/**
 * Build the announcement embed + Download button for one platform update.
 */
function buildUpdateMessage(kind, update) {
  const meta = KINDS[kind];
  const fields = [{ name: 'Platform', value: PLATFORM_LABELS[update.platform] || update.platform, inline: false }];

  if (meta.showVersion && update.version) {
    fields.push({ name: 'Version', value: `\`${update.version}\``, inline: false });
  }

  // Desktop builds are identified by a version hash; mobile ships plain
  // store version numbers, so label the field for what it actually holds.
  const isHash = update.hash.startsWith('version-');
  fields.push(
    { name: isHash ? 'Hash' : 'Version', value: `\`${update.hash}\``, inline: false },
    { name: 'Date', value: `<t:${update.timestamp}:F>`, inline: false },
  );

  const embed = new EmbedBuilder()
    .setColor(meta.color)
    .setTitle(meta.title)
    .setDescription(meta.description)
    .setThumbnail(WEAO_ICON)
    .addFields(fields)
    .setFooter({
      text: 'Powered by WEAO, The #1 Roblox exploit status tracker | Channel: LIVE',
      iconURL: WEAO_ICON,
    });

  const message = { embeds: [embed] };

  const url = downloadUrl(update.platform, update.hash);
  if (url) {
    message.components = [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setLabel('Download').setStyle(ButtonStyle.Link).setURL(url)
    )];
  }

  return message;
}

function parsePlatforms(value) {
  return String(value || '')
    .split(',')
    .map(entry => entry.trim())
    .filter(Boolean);
}

function subscriptionWants(sub, kind, platform) {
  const kinds = parsePlatforms(sub.kinds).map(k => k.toLowerCase());
  if (!kinds.includes(kind)) return false;
  const platforms = parsePlatforms(sub.platforms).map(p => p.toLowerCase());
  return platforms.includes(platform.toLowerCase());
}

function buildPingContent(sub) {
  const mentions = [];
  if (sub.ping_everyone) mentions.push('@everyone');
  if (sub.role_id) mentions.push(`<@&${sub.role_id}>`);
  return mentions.join(' ') || null;
}

async function fetchVersions(kind) {
  const response = await axios.get(KINDS[kind].endpoint, { headers: WEAO_HEADERS, timeout: 10_000 });
  return response.data;
}

/**
 * Deliver one update to every subscribed channel that asked for it.
 */
async function broadcast(client, kind, update) {
  const subs = dbAll('SELECT * FROM roblox_update_subs').filter(sub => subscriptionWants(sub, kind, update.platform));
  if (!subs.length) return 0;

  const message = buildUpdateMessage(kind, update);
  let delivered = 0;

  for (const sub of subs) {
    try {
      const channel = client.channels.cache.get(sub.channel_id)
        || await client.channels.fetch(sub.channel_id).catch(() => null);

      if (!channel || !channel.isTextBased()) {
        logger.warn('roblox-updates', `Channel ${sub.channel_id} is gone · removing subscription`);
        dbRun('DELETE FROM roblox_update_subs WHERE id = ?', [sub.id]);
        continue;
      }

      const content = buildPingContent(sub);
      await channel.send({
        ...message,
        ...(content ? { content } : {}),
        allowedMentions: {
          parse: sub.ping_everyone ? ['everyone'] : [],
          roles: sub.role_id ? [sub.role_id] : [],
        },
      });
      delivered += 1;
    } catch (error) {
      logger.error('roblox-updates', `Could not announce in ${sub.channel_id}`, error);
    }
  }

  return delivered;
}

/**
 * Deliver one update to every user who opted in to DM pings. A closed DM is a
 * hard failure for that user, so drop the subscription rather than retrying it
 * on every future update.
 */
async function broadcastDMs(client, kind, update) {
  const subs = dbAll('SELECT * FROM roblox_update_dms').filter(sub => subscriptionWants(sub, kind, update.platform));
  if (!subs.length) return 0;

  const message = buildUpdateMessage(kind, update);
  let delivered = 0;

  for (const sub of subs) {
    try {
      const user = client.users.cache.get(sub.user_id)
        || await client.users.fetch(sub.user_id).catch(() => null);
      if (!user) {
        dbRun('DELETE FROM roblox_update_dms WHERE user_id = ?', [sub.user_id]);
        continue;
      }

      await user.send(message);
      delivered += 1;
    } catch (error) {
      // 50007 = "Cannot send messages to this user" (DMs closed or bot blocked).
      if (error?.code === 50007) {
        logger.warn('roblox-updates', `DMs closed for ${sub.user_id} · removing subscription`);
        dbRun('DELETE FROM roblox_update_dms WHERE user_id = ?', [sub.user_id]);
      } else {
        logger.error('roblox-updates', `Could not DM ${sub.user_id}`, error);
      }
    }
  }

  return delivered;
}

/**
 * One poll cycle. The first time a platform is seen we only record its hash so
 * a fresh database never fires a burst of "updates" for versions already live.
 */
async function checkOnce(client) {
  for (const kind of Object.keys(KINDS)) {
    let payload;
    try {
      payload = await fetchVersions(kind);
    } catch (error) {
      logger.warn('roblox-updates', `WEAO ${kind} fetch failed · ${error.message}`);
      continue;
    }

    for (const platform of PLATFORMS[kind]) {
      const update = readPlatform(payload, platform);
      if (!update) continue;

      const stateKey = `${kind}:${platform}`;
      const previous = dbGet('SELECT * FROM roblox_update_state WHERE state_key = ?', [stateKey]);

      if (previous && previous.hash === update.hash) continue;

      dbRun(
        'INSERT INTO roblox_update_state (state_key, hash, version, seen_at) VALUES (?, ?, ?, ?) ' +
        'ON CONFLICT(state_key) DO UPDATE SET hash = excluded.hash, version = excluded.version, seen_at = excluded.seen_at',
        [stateKey, update.hash, update.version, Date.now()]
      );

      if (!previous) continue; // Baseline only — nothing to announce yet.

      const [channels, dms] = await Promise.all([
        broadcast(client, kind, update),
        broadcastDMs(client, kind, update),
      ]);
      logger.info('roblox-updates', `${kind} ${platform} → ${update.hash} · ${channels} channel(s), ${dms} DM(s)`);
    }
  }
}

function startRobloxUpdateWatcher(client) {
  const run = () => checkOnce(client).catch(error => {
    logger.error('roblox-updates', 'Update check failed', error);
  });

  run();
  const timer = setInterval(run, POLL_INTERVAL_MS);
  logger.success('roblox-updates', `WEAO watcher started · polling every ${POLL_INTERVAL_MS / 1000}s`);
  return timer;
}

module.exports = {
  startRobloxUpdateWatcher,
  checkOnce,
  broadcastDMs,
  buildUpdateMessage,
  readPlatform,
  fetchVersions,
  PLATFORMS,
  KINDS,
};
