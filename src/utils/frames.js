// ============================================================
// Frame & Pixel Primitives
// ------------------------------------------------------------
// esmBot's image effects are libvips pipelines. sharp is libvips too, so most
// of them port over directly — except `mapim`, which sharp does not expose.
// This module supplies the missing pieces:
//
//   * decoding an animated image into individual RGBA frames
//   * re-encoding frames into an animated GIF/WebP (or a still image)
//   * a JS implementation of libvips' `mapim` displacement remapping
//   * outlined text rendering (the "Impact meme" look)
// ============================================================
const path = require('path');
const sharp = require('sharp');

const FONT_DIR = path.join(__dirname, '..', '..', 'assets', 'fonts');

// Fonts that ship with the repo, plus metric-compatible system substitutes for
// the proprietary families esmBot names (Impact, Times, Helvetica Neue).
const FONTS = {
  impact: { family: 'Anton', file: path.join(FONT_DIR, 'Anton-Regular.ttf'), weight: 'normal' },
  futura: { family: 'Futura Cyrillic Extra Bold', file: path.join(FONT_DIR, 'FuturaCyrillicExtraBold.ttf'), weight: 'normal' },
  times: { family: 'Liberation Serif', file: null, weight: 'bold' },
  helvetica: { family: 'Liberation Sans', file: null, weight: 'normal' },
  arial: { family: 'Liberation Sans', file: null, weight: 'bold' },
  serif: { family: 'DejaVu Serif', file: null, weight: 'bold' },
  sans: { family: 'DejaVu Sans', file: null, weight: 'bold' },
  mono: { family: 'DejaVu Sans Mono', file: null, weight: 'bold' },
};

const ALLOWED_FONTS = Object.keys(FONTS);

const MAX_PIXELS = 40 * 1024 * 1024;
const DEFAULT_MAX_FRAMES = 60;
const DEFAULT_MAX_SIZE = 512;

/** Escape text for Pango markup, which libvips' text renderer parses. */
function escapeMarkup(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function resolveFont(name) {
  return FONTS[String(name || '').toLowerCase()] || FONTS.impact;
}

/** Build the `font` string and optional `fontfile` for sharp's text input. */
function fontOptions(name, size) {
  const font = resolveFont(name);
  const descriptor = `${font.family} ${font.weight === 'bold' ? 'Bold ' : ''}${Math.max(6, Math.round(size))}`;
  return font.file ? { font: descriptor, fontfile: font.file } : { font: descriptor };
}

/**
 * Decode an image (still or animated) into individual RGBA frames.
 *
 * @param {Buffer} buffer
 * @param {object} [options]
 * @param {number} [options.maxSize=512] longest side after downscaling
 * @param {number} [options.maxFrames=60] frames to keep (extras are dropped)
 * @param {boolean} [options.flatten=false] composite onto a solid background
 * @param {string} [options.background='#ffffff'] background used when flattening
 */
async function decodeFrames(buffer, options = {}) {
  const {
    maxSize = DEFAULT_MAX_SIZE,
    maxFrames = DEFAULT_MAX_FRAMES,
    flatten = false,
    background = '#ffffff',
  } = options;

  const metadata = await sharp(buffer, { animated: true, limitInputPixels: MAX_PIXELS }).metadata();
  const totalPages = Math.max(1, metadata.pages || 1);
  const sourceWidth = metadata.width || 1;
  const sourcePageHeight = metadata.pageHeight || metadata.height || 1;

  let width = sourceWidth;
  let height = sourcePageHeight;
  if (maxSize && (width > maxSize || height > maxSize)) {
    const scale = Math.min(maxSize / width, maxSize / height);
    width = Math.max(1, Math.round(width * scale));
    height = Math.max(1, Math.round(height * scale));
  }

  const keptPages = Math.min(totalPages, maxFrames);
  const rawDelays = Array.isArray(metadata.delay) ? metadata.delay : [];

  let pipeline = sharp(buffer, { animated: true, limitInputPixels: MAX_PIXELS, pages: totalPages });
  if (width !== sourceWidth || height !== sourcePageHeight) {
    pipeline = pipeline.resize({ width, height, fit: 'fill' });
  }
  if (flatten) pipeline = pipeline.flatten({ background });

  const { data } = await pipeline.ensureAlpha().raw().toBuffer({ resolveWithObject: true });

  const frameBytes = width * height * 4;
  const frames = [];
  for (let index = 0; index < keptPages; index += 1) {
    frames.push(data.subarray(index * frameBytes, (index + 1) * frameBytes));
  }

  const delays = frames.map((_, index) => {
    const delay = Number(rawDelays[index]);
    // Browsers and Discord clamp anything under 20ms; GIFs commonly encode 0.
    return Number.isFinite(delay) && delay >= 20 ? delay : 100;
  });

  return {
    frames,
    width,
    height,
    delays,
    loop: Number.isFinite(metadata.loop) ? metadata.loop : 0,
    animated: totalPages > 1,
    truncated: totalPages > keptPages,
    sourceWidth,
    sourceHeight: sourcePageHeight,
    sourcePages: totalPages,
    format: metadata.format,
  };
}

function rawImage(frame, width, height) {
  return sharp(Buffer.from(frame), { raw: { width, height, channels: 4 } });
}

/**
 * Encode frames back into a single file.
 *
 * @param {object} image `{ frames, width, height, delays, loop }`
 * @param {object} [options]
 * @param {'gif'|'png'|'webp'|'jpeg'} [options.format] forced output format
 */
async function encodeFrames(image, options = {}) {
  const { frames, width, height } = image;
  if (!frames.length) throw new Error('Nothing to encode: the effect produced no frames.');

  const animated = frames.length > 1;
  const format = options.format || (animated ? 'gif' : 'png');

  if (!animated) {
    const pipeline = rawImage(frames[0], width, height);
    if (format === 'jpeg') return { buffer: await pipeline.flatten({ background: '#ffffff' }).jpeg({ quality: 92 }).toBuffer(), format: 'jpg' };
    if (format === 'webp') return { buffer: await pipeline.webp({ quality: 90 }).toBuffer(), format: 'webp' };
    if (format === 'gif') return { buffer: await pipeline.gif().toBuffer(), format: 'gif' };
    return { buffer: await pipeline.png({ compressionLevel: 9 }).toBuffer(), format: 'png' };
  }

  // sharp can only build an animation from encoded inputs, so round-trip each
  // frame through a fast (uncompressed) PNG first.
  const encoded = await Promise.all(
    frames.map(frame => rawImage(frame, width, height).png({ compressionLevel: 0 }).toBuffer())
  );

  const delays = (image.delays || []).slice(0, frames.length);
  while (delays.length < frames.length) delays.push(delays[delays.length - 1] ?? 100);
  const loop = Number.isFinite(image.loop) ? image.loop : 0;

  const joined = sharp(encoded, { join: { animated: true } });
  if (format === 'webp') {
    return { buffer: await joined.webp({ delay: delays, loop, quality: 90 }).toBuffer(), format: 'webp' };
  }
  return { buffer: await joined.gif({ delay: delays, loop, dither: 0 }).toBuffer(), format: 'gif' };
}

/**
 * Expand a raw buffer to 4 channels. Some sharp operations (greyscale,
 * colourspace changes) legitimately reduce the band count, so normalise rather
 * than assume every pipeline hands back RGBA.
 */
function toRgba(data, width, height, channels) {
  if (channels === 4) return data;
  const output = Buffer.alloc(width * height * 4);
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    const from = pixel * channels;
    const to = pixel * 4;
    if (channels === 1) {
      output[to] = data[from];
      output[to + 1] = data[from];
      output[to + 2] = data[from];
      output[to + 3] = 255;
    } else if (channels === 2) {
      output[to] = data[from];
      output[to + 1] = data[from];
      output[to + 2] = data[from];
      output[to + 3] = data[from + 1];
    } else {
      output[to] = data[from];
      output[to + 1] = data[from + 1];
      output[to + 2] = data[from + 2];
      output[to + 3] = 255;
    }
  }
  return output;
}

/** Run a sharp pipeline over every frame, returning new RGBA frames. */
async function mapFrames(image, transform) {
  const results = [];
  for (let index = 0; index < image.frames.length; index += 1) {
    const output = await transform(rawImage(image.frames[index], image.width, image.height), index);
    const { data, info } = await output.raw().toBuffer({ resolveWithObject: true });
    results.push({ data: toRgba(data, info.width, info.height, info.channels), width: info.width, height: info.height });
  }

  const width = results[0].width;
  const height = results[0].height;
  if (results.some(result => result.width !== width || result.height !== height)) {
    throw new Error('Frames came out at inconsistent sizes.');
  }

  return { ...image, frames: results.map(result => result.data), width, height };
}

// ------------------------------------------------------------
// Displacement remapping (libvips `mapim` equivalent)
// ------------------------------------------------------------

/**
 * Build a displacement map. `fn(x, y)` returns the source coordinate to sample
 * for destination pixel (x, y), as a two-element array.
 */
function buildMap(width, height, fn) {
  const map = new Float32Array(width * height * 2);
  const point = [0, 0];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const result = fn(x, y, point) || point;
      const offset = (y * width + x) * 2;
      map[offset] = result[0];
      map[offset + 1] = result[1];
    }
  }
  return map;
}

function wrapCoordinate(value, size, extend) {
  if (value >= 0 && value <= size - 1) return value;
  switch (extend) {
    case 'repeat': {
      const wrapped = value % size;
      return wrapped < 0 ? wrapped + size : wrapped;
    }
    case 'mirror': {
      const period = 2 * size;
      let wrapped = value % period;
      if (wrapped < 0) wrapped += period;
      return wrapped >= size ? period - wrapped - 1 : wrapped;
    }
    case 'copy':
      return Math.min(size - 1, Math.max(0, value));
    default:
      return NaN; // 'background' — sample nothing
  }
}

/**
 * Sample `source` through `map` with bilinear interpolation.
 *
 * @param {Buffer|Uint8Array} source RGBA pixels
 * @param {number} width
 * @param {number} height
 * @param {Float32Array} map from buildMap, sized for the output
 * @param {object} [options]
 * @param {number} [options.outWidth]
 * @param {number} [options.outHeight]
 * @param {'copy'|'mirror'|'repeat'|'background'} [options.extend='background']
 */
function applyMap(source, width, height, map, options = {}) {
  const outWidth = options.outWidth || width;
  const outHeight = options.outHeight || height;
  const extend = options.extend || 'background';
  const output = Buffer.alloc(outWidth * outHeight * 4);

  for (let y = 0; y < outHeight; y += 1) {
    for (let x = 0; x < outWidth; x += 1) {
      const mapOffset = (y * outWidth + x) * 2;
      const sourceX = wrapCoordinate(map[mapOffset], width, extend);
      const sourceY = wrapCoordinate(map[mapOffset + 1], height, extend);
      const target = (y * outWidth + x) * 4;
      if (!Number.isFinite(sourceX) || !Number.isFinite(sourceY)) continue;

      const x0 = Math.floor(sourceX);
      const y0 = Math.floor(sourceY);
      const x1 = Math.min(width - 1, x0 + 1);
      const y1 = Math.min(height - 1, y0 + 1);
      const fx = sourceX - x0;
      const fy = sourceY - y0;

      const topLeft = (y0 * width + x0) * 4;
      const topRight = (y0 * width + x1) * 4;
      const bottomLeft = (y1 * width + x0) * 4;
      const bottomRight = (y1 * width + x1) * 4;

      for (let channel = 0; channel < 4; channel += 1) {
        const top = source[topLeft + channel] * (1 - fx) + source[topRight + channel] * fx;
        const bottom = source[bottomLeft + channel] * (1 - fx) + source[bottomRight + channel] * fx;
        output[target + channel] = (top * (1 - fy) + bottom * fy + 0.5) | 0;
      }
    }
  }

  return output;
}

/** Remap every frame of an image through one shared displacement map. */
function remapFrames(image, mapFn, options = {}) {
  const outWidth = options.outWidth || image.width;
  const outHeight = options.outHeight || image.height;
  const map = buildMap(outWidth, outHeight, mapFn);
  return {
    ...image,
    width: outWidth,
    height: outHeight,
    frames: image.frames.map(frame => applyMap(frame, image.width, image.height, map, { ...options, outWidth, outHeight })),
  };
}

// ------------------------------------------------------------
// Text rendering
// ------------------------------------------------------------

/**
 * Render text as white glyphs with a black outline, the way esmBot builds its
 * meme/whisper captions (libvips renders the text, blurs the alpha channel to
 * dilate it, then stacks the text back on top).
 */
async function renderOutlinedText(text, options = {}) {
  const { size = 48, width = 512, font = 'impact', align = 'centre', foreground = 'white' } = options;
  const radius = Math.max(1, options.radius ?? size / 18);

  const rendered = await sharp({
    text: {
      text: `<span foreground="${foreground}">${escapeMarkup(text)}</span>`,
      ...fontOptions(font, size),
      width,
      align,
      rgba: true,
    },
  }).png().toBuffer();

  const pad = Math.ceil(radius * 2) + 2;
  const padded = await sharp(rendered)
    .extend({ top: pad, bottom: pad, left: pad, right: pad, background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
  const { width: paddedWidth, height: paddedHeight } = await sharp(padded).metadata();

  // Dilate the glyph alpha into a solid silhouette, then tint it black.
  const silhouette = await sharp(padded)
    .extractChannel('alpha')
    .blur(radius)
    .linear(8, 0)
    .png()
    .toBuffer();
  const outline = await sharp({
    create: { width: paddedWidth, height: paddedHeight, channels: 3, background: '#000000' },
  })
    .joinChannel(silhouette)
    .png()
    .toBuffer();

  const buffer = await sharp(outline).composite([{ input: padded }]).png().toBuffer();
  return { buffer, width: paddedWidth, height: paddedHeight };
}

/** Render plain text with an optional solid background behind the glyphs. */
async function renderText(text, options = {}) {
  const { size = 48, width = 512, font = 'impact', align = 'centre', foreground = 'black', background } = options;
  const span = background
    ? `<span foreground="${foreground}" background="${background}">${escapeMarkup(text)}</span>`
    : `<span foreground="${foreground}">${escapeMarkup(text)}</span>`;

  const buffer = await sharp({
    text: { text: span, ...fontOptions(font, size), width, align, rgba: true },
  }).png().toBuffer();
  const metadata = await sharp(buffer).metadata();
  return { buffer, width: metadata.width, height: metadata.height };
}

module.exports = {
  ALLOWED_FONTS,
  DEFAULT_MAX_FRAMES,
  DEFAULT_MAX_SIZE,
  FONTS,
  applyMap,
  buildMap,
  decodeFrames,
  encodeFrames,
  escapeMarkup,
  fontOptions,
  mapFrames,
  rawImage,
  remapFrames,
  renderOutlinedText,
  renderText,
  resolveFont,
};
