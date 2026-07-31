// ============================================================
// /web/* — routes backing the xocat.online bot playground
// ------------------------------------------------------------
// These power https://xocat.online/bot/playground. The browser never talks to
// this host directly: a Cloudflare Pages Function checks the visitor's Discord
// session and then forwards the call here with a shared bearer secret, so the
// WispByte address and the secret both stay server-side.
//
// Every route below therefore assumes exactly one caller — the proxy — and
// refuses to serve anything at all unless WEB_API_SECRET is configured. An
// unset secret disables the whole router rather than leaving it open.
// ============================================================
const crypto = require('crypto');
const express = require('express');
const rateLimit = require('express-rate-limit');
const { ALLOWED_FONTS, FLAG_NAMES, applyEffect, getEffect, listEffects } = require('../services/imageEffects');
// The per-effect boolean flags live with the slash-command factory because that
// is where they are declared for Discord. Reusing the same table here keeps the
// playground's form in step with the commands instead of duplicating the list.
const { EXTRA_BOOLEANS } = require('../bot/commands/images/_effectCommand.cjs');
const { MediaNotFoundError, downloadMedia } = require('../services/mediaResolver');
const { MediaProbeError, probeMedia } = require('../services/mediaProbe');
const logger = require('../utils/logger');

// Smaller than the Discord-side ceilings: this path pays for a Worker round
// trip in both directions, and the playground is for trying effects out rather
// than for processing 25 MB sources.
const MAX_INPUT_BYTES = 8 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 6 * 1024 * 1024;

// Progressively cheaper passes, used when the first result is too large to
// return. Mirrors mediaCommand.js so the web output matches Discord's.
const RETRY_STEPS = [
  { maxSize: 512, maxFrames: 60 },
  { maxSize: 384, maxFrames: 40 },
  { maxSize: 256, maxFrames: 24 },
  { maxSize: 192, maxFrames: 16 },
];

const CONTENT_TYPES = {
  gif: 'image/gif',
  png: 'image/png',
  webp: 'image/webp',
  jpg: 'image/jpeg',
};

const ALLOWED_FORMATS = new Set(['gif', 'png', 'webp']);

function timingSafeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

/** Bearer check. A missing secret disables the router instead of opening it. */
function requireSecret(req, res, next) {
  const secret = process.env.WEB_API_SECRET?.trim();
  if (!secret) {
    return res.status(503).json({
      error: 'The web playground API is disabled. Set WEB_API_SECRET to enable it.',
    });
  }

  const header = String(req.get('authorization') || '');
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token || !timingSafeEqual(token, secret)) {
    return res.status(401).json({ error: 'Unauthorized.' });
  }

  return next();
}

function readBoolean(value) {
  if (value === undefined || value === null || value === '') return undefined;
  const normalized = String(value).toLowerCase();
  if (normalized === 'true' || normalized === '1' || normalized === 'yes') return true;
  if (normalized === 'false' || normalized === '0' || normalized === 'no') return false;
  return undefined;
}

function readNumber(value) {
  if (value === undefined || value === null || value === '') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

/**
 * Pull effect parameters out of the query string. The proxy sends them there
 * rather than in the body because the body carries the raw image bytes.
 */
function readParams(query) {
  return {
    text: query.text != null ? String(query.text).slice(0, 500) : null,
    amount: readNumber(query.amount),
    font: query.font ? String(query.font).toLowerCase() : null,
    alpha: readBoolean(query.alpha),
    vertical: readBoolean(query.vertical),
    reverse: readBoolean(query.reverse),
    bottom: readBoolean(query.bottom),
    flip: readBoolean(query.flip),
    caseSensitive: readBoolean(query.caseSensitive),
  };
}

/** Serialize one registry entry into something the browser can render a form from. */
function describeEffect(effect) {
  const params = effect.params || {};
  return {
    name: effect.name,
    description: effect.description,
    category: effect.category,
    aliases: effect.aliases || [],
    animated: !!effect.alwaysGif,
    params: {
      text: params.text
        ? {
            required: !!params.text.required,
            description: params.text.description || 'Text for the effect',
          }
        : null,
      amount: params.amount
        ? {
            min: params.amount.min,
            max: params.amount.max,
            default: params.amount.default,
            description: params.amount.description || 'Effect strength',
          }
        : null,
      font: params.font
        ? {
            choices: params.font.choices || ALLOWED_FONTS,
            default: params.font.default || 'impact',
          }
        : null,
    },
    // `[{ name, description }]` — the query-string key is the camelCase form,
    // since that is what applyEffect reads.
    booleans: (EXTRA_BOOLEANS[effect.name] || []).map(([option, description]) => ({
      name: option === 'case-sensitive' ? 'caseSensitive' : option,
      label: option,
      description,
    })),
  };
}

/**
 * Build the /web router.
 *
 * @param {import('discord.js').Client} client the live bot client
 * @returns {import('express').Router}
 */
function createWebRouter(client) {
  const router = express.Router();

  // Tighter than the global limiter: image effects are CPU-bound and this host
  // also has to keep the gateway connection responsive.
  const effectLimiter = rateLimit({
    windowMs: 60000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many effect renders. Give it a minute.' },
  });

  router.use(requireSecret);

  // The registry, so the playground can build its own UI without hardcoding it.
  router.get('/effects', (req, res) => {
    res.set('Cache-Control', 'public, max-age=300');
    res.json({
      effects: listEffects().map(describeEffect),
      fonts: ALLOWED_FONTS,
      flags: FLAG_NAMES,
      limits: {
        maxInputBytes: MAX_INPUT_BYTES,
        maxOutputBytes: MAX_OUTPUT_BYTES,
        formats: [...ALLOWED_FORMATS],
      },
    });
  });

  // Guild IDs the bot is in. The proxy intersects this with the visitor's own
  // guild list to decide whether they may use the playground at all.
  router.get('/guilds', (req, res) => {
    const ids = client?.guilds?.cache ? [...client.guilds.cache.keys()] : [];
    res.set('Cache-Control', 'public, max-age=60');
    res.json({ ids, count: ids.length });
  });

  // Run one effect. The source image arrives either as the raw request body or
  // as `?url=`, which we download here so the browser is not blocked by CORS
  // and so the SSRF guard in utils/network applies.
  router.post(
    '/effect',
    effectLimiter,
    express.raw({ type: () => true, limit: MAX_INPUT_BYTES }),
    async (req, res) => {
      const effect = getEffect(req.query.effect);
      if (!effect) {
        return res.status(400).json({ error: `Unknown effect "${String(req.query.effect || '').slice(0, 40)}".` });
      }

      const params = readParams(req.query);

      if (effect.params?.text?.required && !String(params.text ?? '').trim()) {
        return res.status(400).json({ error: `${effect.name} needs some text.` });
      }

      if (params.font && !ALLOWED_FONTS.includes(params.font)) {
        return res.status(400).json({ error: `Unknown font "${params.font}".` });
      }

      const requestedFormat = req.query.format ? String(req.query.format).toLowerCase() : undefined;
      if (requestedFormat && !ALLOWED_FORMATS.has(requestedFormat)) {
        return res.status(400).json({ error: `Unsupported output format "${requestedFormat}".` });
      }

      let source = Buffer.isBuffer(req.body) && req.body.length ? req.body : null;

      if (!source) {
        const url = String(req.query.url || '').trim();
        if (!url) {
          return res.status(400).json({ error: 'Send image bytes as the request body or pass ?url=.' });
        }

        try {
          const downloaded = await downloadMedia({ url }, { maxBytes: MAX_INPUT_BYTES, timeout: 20000 });
          source = downloaded.buffer;
        } catch (error) {
          if (error instanceof MediaNotFoundError) {
            return res.status(400).json({ error: error.message });
          }
          return res.status(400).json({ error: 'Could not download that image URL.' });
        }
      }

      try {
        let result;
        let attempt = 0;
        for (const step of RETRY_STEPS) {
          attempt += 1;
          result = await applyEffect(source, effect.name, params, {
            maxSize: Math.min(step.maxSize, effect.maxSize ?? step.maxSize),
            maxFrames: step.maxFrames,
            format: requestedFormat,
          });
          if (result.buffer.length <= MAX_OUTPUT_BYTES) break;
        }

        if (result.buffer.length > MAX_OUTPUT_BYTES) {
          return res.status(413).json({
            error: `The result came out at ${(result.buffer.length / 1024 / 1024).toFixed(1)} MB even after shrinking it. Try a smaller or shorter source.`,
          });
        }

        const notes = [...(result.notes || [])];
        if (result.truncated) notes.push('long animation trimmed');
        if (attempt > 1) notes.push('downscaled to fit the size limit');

        res.set({
          'Content-Type': CONTENT_TYPES[result.format] || 'application/octet-stream',
          'Content-Disposition': `inline; filename="${effect.name}.${result.format}"`,
          'Cache-Control': 'no-store',
          // Metadata the playground shows next to the result. Header rather
          // than body so the response can stay the raw image.
          'X-Effect-Name': effect.name,
          'X-Effect-Format': result.format,
          'X-Effect-Width': String(result.width),
          'X-Effect-Height': String(result.height),
          'X-Effect-Frames': String(result.frames),
          'X-Effect-Notes': notes.join(' • '),
        });
        return res.send(result.buffer);
      } catch (error) {
        logger.error('web', `Effect ${effect.name} failed`, error);
        return res.status(500).json({ error: `Could not apply ${effect.name}.` });
      }
    },
  );

  // Media metadata lookup — the same probe /scrape uses, behind the secret.
  router.get('/media', async (req, res) => {
    try {
      const media = await probeMedia(req.query.url);
      return res.json({ status: 'success', media });
    } catch (error) {
      if (error instanceof MediaProbeError) {
        return res.status(error.status).json({ error: error.message, message: error.detail });
      }
      logger.error('web', 'Media probe failed', error);
      return res.status(500).json({ error: 'Media probe failed.' });
    }
  });

  return router;
}

module.exports = { MAX_INPUT_BYTES, MAX_OUTPUT_BYTES, createWebRouter };
