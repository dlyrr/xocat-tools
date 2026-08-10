// ============================================================
// Apple emoji inside rendered text
// ------------------------------------------------------------
// Pango draws emoji with whatever font the host happens to have: Segoe on
// Windows, a monochrome outline on a bare Linux box, a blank box on a machine
// with no emoji font at all. A caption should look the same wherever the bot
// runs, so emoji never reach Pango as text. Each one is swapped for a coloured
// marker square exactly one em wide, and the Apple artwork is composited into
// wherever that square landed.
//
// Marking the spot rather than measuring it is what keeps this simple: Pango
// still does the line breaking, wrapping, and alignment, and the answer to
// "where did that glyph end up" is read back off the bitmap instead of being
// predicted. Pango fills a span background as a solid rectangle, so the marker
// survives as an exact colour with no antialiasing to threshold against.
// ============================================================
const sharp = require('sharp');
const { UNICODE_EMOJI, appleEmojiUrls, downloadMedia } = require('../services/mediaResolver');

// U+3000 is one em wide, which is the space emoji artwork is drawn to occupy.
const MARKER_GLYPH = '　';
// Markers are #FF<index>FE: red and blue pin the colour down, green carries
// which emoji it is. Nothing else in a caption lands on it — the palette is
// black and white text on a white or translucent bar.
const MARKER_RED = 255;
const MARKER_BLUE = 254;
const MARKER_LIMIT = 200;

const cache = new Map();

/** Emoji artwork, downloaded once per emoji and kept for the process's life. */
function loadEmoji(emoji) {
  if (!cache.has(emoji)) {
    const [url, ...fallbackUrls] = appleEmojiUrls(emoji);
    cache.set(emoji, downloadMedia({ url, fallbackUrls }, { maxBytes: 1024 * 1024, timeout: 10000 })
      .then(media => media.buffer)
      .catch(() => null));
  }
  return cache.get(emoji);
}

/**
 * Whether a sequence should become artwork rather than stay as text.
 *
 * A lone character that defaults to text presentation is left alone: someone
 * typing © or ™ or ‼ in a caption means the punctuation, not a picture. Adding
 * anything to it — a variation selector from an emoji picker, a skin tone, a
 * keycap, a ZWJ join — makes the intent unambiguous.
 */
function isPictorial(sequence) {
  const points = [...sequence];
  if (points.length > 1) return true;
  return /\p{Emoji_Presentation}/u.test(points[0]);
}

/**
 * Split text into literal runs and the emoji between them.
 * Emoji past MARKER_LIMIT stay as text; a caption cannot hold that many.
 */
function splitEmoji(text) {
  const pattern = new RegExp(UNICODE_EMOJI.source, 'gu');
  const segments = [];
  let cursor = 0;
  let count = 0;

  for (const match of String(text ?? '').matchAll(pattern)) {
    if (count >= MARKER_LIMIT || !isPictorial(match[0])) continue;
    if (match.index > cursor) segments.push({ text: text.slice(cursor, match.index) });
    segments.push({ emoji: match[0], index: count });
    cursor = match.index + match[0].length;
    count += 1;
  }
  if (cursor < String(text ?? '').length) segments.push({ text: text.slice(cursor) });

  return segments;
}

/**
 * Find each marker square and clear it. Returns the bounding boxes by emoji
 * index, and mutates `data` so the markers leave no colour behind — the alpha
 * that remains is the text's own, which matters because renderOutlinedText
 * builds its outline from that alpha.
 */
function extractMarkers(data, info) {
  const boxes = new Map();

  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      const offset = (y * info.width + x) * info.channels;
      if (data[offset] !== MARKER_RED || data[offset + 2] !== MARKER_BLUE) continue;
      if (data[offset + 3] !== 255) continue;
      const index = data[offset + 1];
      if (index >= MARKER_LIMIT) continue;

      const box = boxes.get(index);
      if (!box) boxes.set(index, { left: x, top: y, right: x, bottom: y });
      else {
        if (x < box.left) box.left = x;
        if (x > box.right) box.right = x;
        if (y < box.top) box.top = y;
        if (y > box.bottom) box.bottom = y;
      }

      data.fill(0, offset, offset + 4);
    }
  }

  return boxes;
}

function escapeMarkup(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Build Pango markup for `text` with emoji replaced by marker spans.
 * `attributes` is the markup for the span wrapping the whole string.
 */
function buildMarkup(segments, attributes) {
  const body = segments.map(segment => (segment.text !== undefined
    ? escapeMarkup(segment.text)
    : `<span background="#${MARKER_RED.toString(16)}${segment.index.toString(16).padStart(2, '0')}${MARKER_BLUE.toString(16)}">${MARKER_GLYPH}</span>`)).join('');
  return `<span ${attributes}>${body}</span>`;
}

/**
 * Composite artwork over the markers in a rendered text bitmap. An emoji that
 * could not be fetched leaves its square blank rather than failing the command;
 * a caption missing one picture still beats no caption at all.
 */
async function paintEmoji(buffer, segments) {
  const emoji = segments.filter(segment => segment.emoji !== undefined);
  const images = await Promise.all(emoji.map(segment => loadEmoji(segment.emoji)));

  const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const boxes = extractMarkers(data, info);
  const cleaned = sharp(data, { raw: { width: info.width, height: info.height, channels: info.channels } });

  const overlays = [];
  for (const [position, segment] of emoji.entries()) {
    const box = boxes.get(segment.index);
    const image = images[position];
    if (!box || !image) continue;

    const size = Math.max(1, Math.min(box.right - box.left + 1, box.bottom - box.top + 1));
    overlays.push({
      input: await sharp(image).resize(size, size, { fit: 'inside' }).png().toBuffer(),
      left: box.left + Math.round(((box.right - box.left + 1) - size) / 2),
      top: box.top + Math.round(((box.bottom - box.top + 1) - size) / 2),
    });
  }

  return (overlays.length ? cleaned.composite(overlays) : cleaned).png().toBuffer();
}

/**
 * Render Pango text, drawing any emoji as Apple artwork.
 *
 * @param {string} text
 * @param {string} attributes markup attributes for the wrapping span
 * @param {object} textOptions passed through to sharp's text input
 */
async function renderPangoText(text, attributes, textOptions) {
  const segments = splitEmoji(text);
  const hasEmoji = segments.some(segment => segment.emoji !== undefined);

  const render = markup => sharp({ text: { text: markup, ...textOptions, rgba: true } }).png().toBuffer();
  if (!hasEmoji) return render(`<span ${attributes}>${escapeMarkup(text)}</span>`);

  try {
    return await paintEmoji(await render(buildMarkup(segments, attributes)), segments);
  } catch {
    // Never let the emoji path cost someone their caption.
    return render(`<span ${attributes}>${escapeMarkup(text)}</span>`);
  }
}

module.exports = {
  buildMarkup,
  escapeMarkup,
  isPictorial,
  renderPangoText,
  splitEmoji,
};
