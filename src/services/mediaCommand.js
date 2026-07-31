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
const MAX_OUTPUT_BYTES = 9 * 1024 * 1024;

// Progressively cheaper passes, used when the first result is too large to
// attach. Each entry is `{ maxSize, maxFrames }`.
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

  let result;
  let attempt = 0;
  for (const step of RETRY_STEPS) {
    attempt += 1;
    result = await applyEffect(media.buffer, effect.name, params, {
      maxSize: Math.min(step.maxSize, effect.maxSize ?? step.maxSize),
      maxFrames: step.maxFrames,
      format,
    });
    if (result.buffer.length <= MAX_OUTPUT_BYTES) break;
  }

  if (result.buffer.length > MAX_OUTPUT_BYTES) {
    return interaction.editReply(
      `❌ The result came out at ${(result.buffer.length / 1024 / 1024).toFixed(1)} MB even after shrinking it, which is over the ${Math.floor(MAX_OUTPUT_BYTES / 1024 / 1024)} MB upload limit. Try a smaller or shorter source.`
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
  MAX_OUTPUT_BYTES,
  readParams,
  runEffect,
};
