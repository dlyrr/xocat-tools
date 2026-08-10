// ============================================================
// Flexible Media Resolution
// ------------------------------------------------------------
// esmBot lets you run an image command without attaching anything: it walks
// backwards through the invocation looking for the most recent usable image.
// This module gives every media command in this bot the same behaviour, for
// both slash commands and prefix commands.
//
// Resolution order (first match wins):
//   1. an explicit attachment option
//   2. an explicit link/url option (URL, custom emoji, or user mention)
//   3. an explicit user option (their avatar)
//   4. attachments, embeds, or stickers on the invoking message
//   5. a custom/unicode emoji or bare URL inside the invoking message text
//   6. the same checks against the message being replied to
//   7. the same checks against recent messages in the channel
// ============================================================
const axios = require('axios');
const { getPublicStream } = require('../utils/network');

const IMAGE_EXTENSIONS = /\.(png|jpe?g|webp|gif|avif|bmp|tiff?|jfif)(?:\?|#|$)/i;
const VIDEO_EXTENSIONS = /\.(mp4|webm|mov|mkv|m4v|avi)(?:\?|#|$)/i;
const CUSTOM_EMOJI = /<(a)?:([\w\d_]+):(\d{15,25})>/;
const USER_MENTION = /^<@!?(\d{15,25})>$/;
const BARE_URL = /https?:\/\/\S+/i;

// A keycap (1️⃣), a two-letter flag (🇯🇵), or an extended pictographic sequence
// with its ZWJ joins, skin tones, and tag characters (🏴󠁧󠁢󠁳󠁣󠁴󠁿). Keycaps and flags
// need their own alternatives because digits and regional indicators are not
// Extended_Pictographic, so the third branch cannot start on one.
const UNICODE_EMOJI = /[0-9#*]️?⃣|[\u{1F1E6}-\u{1F1FF}]{2}|\p{Extended_Pictographic}(?:️|⃣|[\u{1F3FB}-\u{1F3FF}]|[\u{E0020}-\u{E007F}])*(?:‍\p{Extended_Pictographic}(?:️|[\u{1F3FB}-\u{1F3FF}])*)*/u;

// jsDelivr mirror of the Apple emoji asset set — the artwork iOS and macOS ship.
// esmBot uses Twemoji here; Apple's set is what people picture when they think
// "emoji", and at 160px it also beats Twemoji's 72px once an effect scales it up.
const APPLE_EMOJI_BASE = 'https://cdn.jsdelivr.net/gh/iamcal/emoji-data@master/img-apple-160';
const SKIN_TONES = [0x1f3fb, 0x1f3ff];
const VARIATION_SELECTOR = 0xfe0f;

const DEFAULT_MAX_BYTES = 25 * 1024 * 1024;
const DEFAULT_HISTORY_LIMIT = 50;

class MediaNotFoundError extends Error {}

/**
 * Build a media descriptor. `contentType` may be undefined for scraped URLs;
 * callers should treat the extension as a hint and validate after download.
 */
function describe(url, { name, contentType, size, source, animated, fallbackUrls } = {}) {
  return {
    url,
    name: name || guessName(url),
    contentType: contentType || undefined,
    size: Number.isFinite(size) ? size : undefined,
    source: source || 'unknown',
    animated: animated ?? /\.gif(?:\?|#|$)/i.test(url),
    // Only emoji set this: alternative spellings of the same picture to try if
    // the preferred filename is not in the asset set. See appleEmojiCandidates.
    fallbackUrls: fallbackUrls?.length ? fallbackUrls : undefined,
  };
}

function guessName(url) {
  try {
    const pathname = new URL(url).pathname;
    const base = pathname.split('/').filter(Boolean).pop();
    return base || 'media';
  } catch {
    return 'media';
  }
}

function looksLikeImage(url, contentType) {
  if (contentType) return contentType.startsWith('image/');
  return IMAGE_EXTENSIONS.test(url);
}

function looksLikeVideo(url, contentType) {
  if (contentType) return contentType.startsWith('video/');
  return VIDEO_EXTENSIONS.test(url);
}

function accepts(url, contentType, allowVideo) {
  if (looksLikeImage(url, contentType)) return true;
  return allowVideo && looksLikeVideo(url, contentType);
}

function avatarUrl(user, size = 512) {
  if (!user) return null;
  return user.displayAvatarURL({ size, extension: user.avatar?.startsWith('a_') ? 'gif' : 'png' });
}

function emojiUrlFromMatch(match) {
  const [, animated, name, id] = match;
  return describe(
    `https://cdn.discordapp.com/emojis/${id}.${animated ? 'gif' : 'png'}?size=512&quality=lossless`,
    { name: `${name}.${animated ? 'gif' : 'png'}`, contentType: animated ? 'image/gif' : 'image/png', source: 'emoji', animated: !!animated }
  );
}

function isSkinTone(point) {
  return point >= SKIN_TONES[0] && point <= SKIN_TONES[1];
}

/**
 * True when a codepoint draws as text unless a variation selector asks for the
 * emoji form — ❤ and ♂ and the keycap digits, as opposed to 😀 and ⭐.
 */
function needsVariationSelector(point) {
  const character = String.fromCodePoint(point);
  return /\p{Emoji}/u.test(character) && !/\p{Emoji_Presentation}/u.test(character);
}

function formatCodepoints(points) {
  return points.map(point => point.toString(16).padStart(4, '0')).join('-');
}

/**
 * Convert a unicode emoji to its Apple asset filename.
 *
 * Twemoji names a file after the codepoints with every variation selector
 * stripped; Apple's set (via iamcal/emoji-data) keeps FE0F on exactly those
 * characters that need it to render as a picture at all, and zero-pads each
 * codepoint to four digits. So ❤️ is `2764-fe0f.png` rather than `2764.png`,
 * and 1️⃣ is `0031-fe0f-20e3.png` rather than `31-fe0f-20e3.png`.
 *
 * Normalising rather than trusting the input matters because both spellings
 * arrive in practice: a bare `❤` still has to find `2764-fe0f.png`. The one
 * exception is a skin tone, which forces the emoji form by itself, so the
 * selector is dropped in front of it (⛹🏽 is `26f9-1f3fd`, not `26f9-fe0f-…`).
 */
function appleEmojiCodepoints(emoji) {
  const points = [...emoji]
    .map(character => character.codePointAt(0))
    .filter(point => point !== VARIATION_SELECTOR);
  if (!points.length) return null;

  const normalised = [];
  points.forEach((point, index) => {
    normalised.push(point);
    if (needsVariationSelector(point) && !isSkinTone(points[index + 1])) {
      normalised.push(VARIATION_SELECTOR);
    }
  });
  return formatCodepoints(normalised);
}

/**
 * Filenames to try for one emoji, best first. The asset set is not perfectly
 * regular and gains sequences with every Unicode release, so rather than let a
 * single miss become "could not download that file", fall back to the
 * selector-free spelling and finally to the sequence's leading character — the
 * same degradation a font performs when it lacks a ligature.
 */
function appleEmojiCandidates(emoji) {
  const preferred = appleEmojiCodepoints(emoji);
  if (!preferred) return [];

  const points = [...emoji].map(character => character.codePointAt(0));
  const bare = formatCodepoints(points.filter(point => point !== VARIATION_SELECTOR));
  const lead = appleEmojiCodepoints(String.fromCodePoint(points[0]));

  return [...new Set([preferred, bare, lead])].filter(Boolean);
}

function findUnicodeEmoji(text) {
  const match = UNICODE_EMOJI.exec(text);
  if (!match) return null;
  const [codepoints, ...fallbacks] = appleEmojiCandidates(match[0]);
  if (!codepoints) return null;
  return describe(`${APPLE_EMOJI_BASE}/${codepoints}.png`, {
    name: `${codepoints}.png`,
    contentType: 'image/png',
    source: 'emoji',
    animated: false,
    fallbackUrls: fallbacks.map(name => `${APPLE_EMOJI_BASE}/${name}.png`),
  });
}

function fromAttachments(message, allowVideo) {
  for (const attachment of message.attachments?.values?.() || []) {
    if (!accepts(attachment.url, attachment.contentType, allowVideo)) continue;
    return describe(attachment.url, {
      name: attachment.name,
      contentType: attachment.contentType,
      size: attachment.size,
      source: 'attachment',
    });
  }
  return null;
}

function fromEmbeds(message, allowVideo) {
  for (const embed of message.embeds || []) {
    const candidates = [embed.image?.url, embed.thumbnail?.url];
    if (allowVideo) candidates.push(embed.video?.url);
    for (const url of candidates) {
      if (url && accepts(url, null, allowVideo)) return describe(url, { source: 'embed' });
    }
  }
  return null;
}

function fromStickers(message) {
  for (const sticker of message.stickers?.values?.() || []) {
    // Lottie stickers (format 3) are vector animations that sharp cannot read.
    if (sticker.format === 3 || sticker.format === 'LOTTIE') continue;
    if (sticker.url) return describe(sticker.url, { name: `${sticker.name}.png`, source: 'sticker' });
  }
  return null;
}

function fromText(text, allowVideo) {
  if (!text) return null;

  const emoji = CUSTOM_EMOJI.exec(text);
  if (emoji) return emojiUrlFromMatch(emoji);

  const url = BARE_URL.exec(text);
  if (url) {
    const cleaned = url[0].replace(/[)>\].,!?]+$/, '');
    if (accepts(cleaned, null, allowVideo)) return describe(cleaned, { source: 'url' });
  }

  return findUnicodeEmoji(text);
}

function fromMessage(message, allowVideo, { includeText = true } = {}) {
  if (!message) return null;
  return (
    fromAttachments(message, allowVideo)
    || fromEmbeds(message, allowVideo)
    || fromStickers(message)
    || (includeText ? fromText(message.content, allowVideo) : null)
  );
}

async function fromHistory(interaction, allowVideo, limit) {
  const channel = interaction.channel;
  if (!channel?.messages?.fetch) return null;
  let messages;
  try {
    messages = await channel.messages.fetch({ limit });
  } catch {
    // Missing Read Message History, or a channel type we cannot scan.
    return null;
  }
  for (const message of messages.values()) {
    const found = fromMessage(message, allowVideo);
    if (found) return { ...found, source: `${found.source} (history)` };
  }
  return null;
}

/**
 * Resolve a media descriptor for a command invocation.
 *
 * @param {object} interaction slash interaction or PrefixInteraction
 * @param {object} [options]
 * @param {string} [options.attachmentOption='file'] attachment option name
 * @param {string} [options.linkOption='link'] string option holding a URL/emoji/mention
 * @param {string} [options.userOption='user'] user option to fall back to an avatar
 * @param {boolean} [options.allowVideo=false] accept video files too
 * @param {number} [options.historyLimit] messages to scan (0 disables scanning)
 * @returns {Promise<object|null>}
 */
async function findMedia(interaction, options = {}) {
  const {
    attachmentOption = 'file',
    linkOption = 'link',
    userOption = 'user',
    allowVideo = false,
    historyLimit = DEFAULT_HISTORY_LIMIT,
  } = options;

  const getOption = (getter, name) => {
    if (!name) return null;
    try {
      return interaction.options?.[getter]?.(name) ?? null;
    } catch {
      // Option is not declared on this command; ignore.
      return null;
    }
  };

  const attachment = getOption('getAttachment', attachmentOption);
  if (attachment) {
    return describe(attachment.url, {
      name: attachment.name,
      contentType: attachment.contentType,
      size: attachment.size,
      source: 'attachment',
    });
  }

  const link = getOption('getString', linkOption);
  if (link?.trim()) {
    const trimmed = link.trim();

    const mention = USER_MENTION.exec(trimmed) || (/^\d{15,25}$/.test(trimmed) ? [null, trimmed] : null);
    if (mention) {
      const user = await interaction.client.users.fetch(mention[1]).catch(() => null);
      const url = avatarUrl(user);
      if (url) return describe(url, { name: `${user.username}.png`, source: 'avatar' });
    }

    const fromLink = fromText(trimmed, allowVideo);
    if (fromLink) return fromLink;

    // A URL without a recognisable extension can still be an image; let the
    // download step decide instead of rejecting it here.
    if (BARE_URL.test(trimmed)) return describe(trimmed, { source: 'url' });

    throw new MediaNotFoundError(`\`${trimmed.slice(0, 100)}\` is not a URL, custom emoji, or user I can pull an image from.`);
  }

  const user = getOption('getUser', userOption);
  if (user) {
    const url = avatarUrl(user);
    if (url) return describe(url, { name: `${user.username}.png`, source: 'avatar' });
  }

  const message = interaction.message || null;
  if (message) {
    const own = fromMessage(message, allowVideo, { includeText: false })
      // Prefix invocations put the command name in the content, so only look at
      // the text after stripping anything that is not emoji/URL shaped.
      || fromText(message.content, allowVideo);
    if (own) return own;

    const reference = message.reference || message.messageReference;
    if (reference?.messageId || reference?.messageID) {
      const replied = await message.channel?.messages
        ?.fetch(reference.messageId || reference.messageID)
        .catch(() => null);
      const found = fromMessage(replied, allowVideo);
      if (found) return { ...found, source: `${found.source} (reply)` };
    }
  }

  if (historyLimit > 0) {
    const found = await fromHistory(interaction, allowVideo, historyLimit);
    if (found) return found;
  }

  return null;
}

/**
 * Same as findMedia but throws a user-facing error when nothing turns up.
 */
async function requireMedia(interaction, options = {}) {
  const media = await findMedia(interaction, options);
  if (media) return media;
  throw new MediaNotFoundError(
    options.noMediaMessage
    || 'I could not find an image to work with. Attach one, reply to a message with one, paste a link or custom emoji, or mention a user to use their avatar.'
  );
}

/**
 * Discord signs its attachment URLs and refuses unsigned ones with a 404, so
 * "Could not download that file" is a misleading way to report the single most
 * common cause: a link typed or copied without its `?ex=&is=&hm=` query string.
 * Naming it saves the person guessing at a file that is plainly still there.
 */
function describeDownloadFailure(url, status) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return `Could not download that file (HTTP ${status}).`;
  }

  const isDiscordCdn = /(^|\.)(cdn\.discordapp\.com|media\.discordapp\.net)$/i.test(parsed.hostname);
  const isSigned = parsed.searchParams.has("ex") && parsed.searchParams.has("hm");

  if (status === 404 && isDiscordCdn && !isSigned) {
    return "That Discord link is missing its signature, so Discord will not serve it — this happens when the URL is retyped or copied as text. "
      + "Attach the file directly with the `file:` option, or right click the image in Discord and choose Copy Link, which gives a longer URL ending in `?ex=…&is=…&hm=…`. "
      + "Leaving both options empty also works: the most recent image in the channel is used.";
  }

  if (status === 404 && isDiscordCdn) {
    return "Discord no longer serves that attachment — its link has expired, or the message was deleted. Copy the link again, or attach the file with `file:`.";
  }

  return `Could not download that file (HTTP ${status}).`;
}

/**
 * Download a resolved media descriptor, enforcing a hard byte ceiling while
 * streaming so an oversized file never lands in memory in full. A descriptor
 * carrying fallbackUrls (emoji) tries each in turn, but reports the failure of
 * the preferred URL, since that is the one worth naming in an error.
 */
async function downloadMedia(media, options = {}) {
  const { maxBytes = DEFAULT_MAX_BYTES } = options;
  if (Number.isFinite(media.size) && media.size > maxBytes) {
    throw new MediaNotFoundError(`That file is ${(media.size / 1024 / 1024).toFixed(1)} MB; the limit is ${Math.floor(maxBytes / 1024 / 1024)} MB.`);
  }

  let firstError;
  for (const url of [media.url, ...(media.fallbackUrls || [])]) {
    try {
      return await downloadFrom(media, url, options);
    } catch (error) {
      firstError = firstError || error;
    }
  }
  throw firstError;
}

async function downloadFrom(media, url, { maxBytes = DEFAULT_MAX_BYTES, timeout = 30000 } = {}) {
  const response = await getPublicStream(axios, url, { timeout, maxRedirects: 5 });
  if (response.status >= 400) {
    throw new MediaNotFoundError(describeDownloadFailure(url, response.status));
  }

  const chunks = [];
  let total = 0;
  await new Promise((resolve, reject) => {
    response.data.on('data', chunk => {
      total += chunk.length;
      if (total > maxBytes) {
        response.data.destroy();
        reject(new MediaNotFoundError(`That file is larger than the ${Math.floor(maxBytes / 1024 / 1024)} MB limit.`));
        return;
      }
      chunks.push(chunk);
    });
    response.data.on('end', resolve);
    response.data.on('error', reject);
  });

  const contentType = String(response.headers['content-type'] || '').split(';')[0].trim();
  return {
    ...media,
    url,
    fallbackUrls: undefined,
    buffer: Buffer.concat(chunks),
    size: total,
    contentType: media.contentType || contentType || undefined,
  };
}

/**
 * Convenience wrapper: resolve then download in one step.
 */
async function fetchMedia(interaction, options = {}) {
  const media = await requireMedia(interaction, options);
  return downloadMedia(media, options);
}

module.exports = {
  MediaNotFoundError,
  appleEmojiCandidates,
  appleEmojiCodepoints,
  avatarUrl,
  downloadMedia,
  fetchMedia,
  findMedia,
  findUnicodeEmoji,
  looksLikeImage,
  looksLikeVideo,
  requireMedia,
};
