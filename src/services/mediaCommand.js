// ============================================================
// Shared runner for image-effect commands
// ------------------------------------------------------------
// Resolves the source media, runs an effect, and replies with the result —
// shrinking and retrying when the output would exceed Discord's upload limit.
// Used by /image and the dedicated effect commands so they all behave the same
// way and share one set of limits.
// ============================================================
const { AttachmentBuilder, EmbedBuilder } = require('discord.js');
const { colors } = require('../utils/constants');
const { MediaNotFoundError, fetchMedia } = require('./mediaResolver');
const { applyEffect, getEffect } = require('./imageEffects');

const MAX_INPUT_BYTES = 25 * 1024 * 1024;

// What a bot may attach is set by the server's Boost level, not by anyone's Nitro
// — Nitro raises the limit for the person who bought it, and only reaches a bot
// indirectly, by way of the two boosts it grants. In a DM there is no guild to
// boost, so the floor applies.
const UPLOAD_LIMIT_BY_TIER = [
  25 * 1024 * 1024, // unboosted
  25 * 1024 * 1024, // level 1
  50 * 1024 * 1024, // level 2
  100 * 1024 * 1024, // level 3
];

// Discord measures the whole multipart request, not just the file, so leave room
// for the embed and the boundaries rather than aiming at the limit exactly.
const UPLOAD_HEADROOM = 0.95;

/** The real ceiling for this channel, read off the guild at send time. */
function uploadLimitFor(interaction) {
  const tier = Number(interaction?.guild?.premiumTier) || 0;
  const limit = UPLOAD_LIMIT_BY_TIER[tier] ?? UPLOAD_LIMIT_BY_TIER[0];
  return Math.floor(limit * UPLOAD_HEADROOM);
}

// The first pass is deliberately untouched: full resolution, every frame. Nothing
// is shrunk on the chance that it might not fit — it is shrunk only once a real
// encoded result has come out too big. Downscaling up front cost quality on every
// single request, and on a caption it also blurred the glyph edges enough to
// defeat the bar detection in /uncaption.
const RETRY_STEPS = [
  { maxSize: Infinity, maxFrames: Infinity },
  { maxSize: 768, maxFrames: 120 },
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

/** Pull the generic effect parameters out of a slash/prefix interaction. */
function readParams(interaction) {
  const get = (getter, name) => {
    try {
      return interaction.options?.[getter]?.(name) ?? null;
    } catch {
      return null;
    }
  };

  return {
    text: get('getString', 'text'),
    amount: get('getNumber', 'amount'),
    font: get('getString', 'font'),
    position: get('getString', 'position'),
    alpha: get('getBoolean', 'alpha') ?? undefined,
    vertical: get('getBoolean', 'vertical') ?? undefined,
    reverse: get('getBoolean', 'reverse') ?? undefined,
    bottom: get('getBoolean', 'bottom') ?? undefined,
    flip: get('getBoolean', 'flip') ?? undefined,
    caseSensitive: get('getBoolean', 'case-sensitive') ?? undefined,
  };
}

/**
 * Run an effect and reply with the result.
 *
 * @param {object} interaction slash interaction or PrefixInteraction
 * @param {string} effectName effect name or alias
 * @param {object} [options]
 * @param {object} [options.params] overrides merged over the parsed options
 * @param {string} [options.format] forced output format
 * @param {string} [options.title] embed title (defaults to the effect name)
 */
async function runEffect(interaction, effectName, options = {}) {
  const effect = getEffect(effectName);
  if (!effect) throw new Error(`Unknown effect \`${String(effectName).slice(0, 40)}\`.`);

  const quiet = (() => {
    try {
      return interaction.options?.getBoolean?.('quiet') ?? false;
    } catch {
      return false;
    }
  })();

  if (!interaction.deferred && !interaction.replied) {
    await interaction.deferReply({ flags: quiet ? 64 : undefined });
  }

  const params = { ...readParams(interaction), ...(options.params || {}) };

  // `.hue 90` through /image puts "90" in text, because text is the greedy
  // option there. Effects with no text parameter but a numeric one clearly meant
  // the number, so move it across rather than silently ignoring it.
  if (params.text != null && params.amount == null && !effect.params?.text && effect.params?.amount) {
    const numeric = Number(String(params.text).trim());
    if (Number.isFinite(numeric)) {
      params.amount = numeric;
      params.text = null;
    }
  }

  // Validate required text up front so we do not download a file for nothing.
  if (effect.params?.text?.required && !String(params.text ?? '').trim()) {
    return interaction.editReply(`❌ \`${effect.name}\` needs some text. Pass it with the \`text\` option.`);
  }

  let media;
  try {
    media = await fetchMedia(interaction, {
      allowVideo: false,
      maxBytes: MAX_INPUT_BYTES,
      noMediaMessage: `I could not find an image to ${effect.name}. Attach one, reply to a message with one, paste a link or custom emoji, or mention a user to use their avatar.`,
    });
  } catch (error) {
    if (error instanceof MediaNotFoundError) return interaction.editReply(`❌ ${error.message}`);
    throw error;
  }

  const format = options.format
    || (() => {
      try {
        return interaction.options?.getString?.('format') || undefined;
      } catch {
        return undefined;
      }
    })();

  const uploadLimit = uploadLimitFor(interaction);

  let result;
  let attempt = 0;
  for (const step of RETRY_STEPS) {
    attempt += 1;
    const effectCap = effect.maxSize ?? Infinity;
    const maxSize = Math.min(step.maxSize, effectCap);

    result = await applyEffect(media.buffer, effect.name, params, {
      // Infinity, not null: applyEffect resolves this with `??`, so a null would be
      // read as "unset" and fall through to the 512 default, quietly downscaling the
      // pass that exists precisely to avoid it. Infinity survives, and both
      // `width > Infinity` and `Math.min(frames, Infinity)` do the right thing.
      maxSize,
      maxFrames: step.maxFrames,
      format,
    });
    if (result.buffer.length <= uploadLimit) break;
  }

  if (result.buffer.length > uploadLimit) {
    return interaction.editReply(
      `❌ The result came out at ${(result.buffer.length / 1024 / 1024).toFixed(1)} MB even after shrinking it, which is over this server's ${Math.floor(uploadLimit / 1024 / 1024)} MB upload limit. Boosting the server raises it, or try a smaller or shorter source.`
    );
  }

  const filename = `${effect.name}.${result.format}`;
  const attachment = new AttachmentBuilder(result.buffer, {
    name: filename,
    contentType: CONTENT_TYPES[result.format],
  });

  const notes = [...(result.notes || [])];
  if (result.truncated) notes.push('long animation trimmed');
  if (attempt > 1) notes.push('downscaled to fit the upload limit');

  const embed = new EmbedBuilder()
    .setColor(colors.utility)
    .setTitle(options.title || `${effect.name.charAt(0).toUpperCase()}${effect.name.slice(1)}`)
    .setDescription(effect.description)
    .addFields(
      { name: 'Output', value: `${result.width}×${result.height} · ${result.frames} frame${result.frames === 1 ? '' : 's'}`, inline: true },
      { name: 'Size', value: `${(result.buffer.length / 1024).toFixed(0)} KB`, inline: true },
      { name: 'Source', value: media.source, inline: true },
    )
    .setImage(`attachment://${filename}`)
    .setTimestamp();
  if (notes.length) embed.setFooter({ text: notes.join(' • ') });

  return interaction.editReply({ embeds: [embed], files: [attachment] });
}

module.exports = {
  MAX_INPUT_BYTES,
  uploadLimitFor,
  readParams,
  runEffect,
};
