// ============================================================
// Image Effect Engine
// ------------------------------------------------------------
// A port of esmBot's image-editing command set. esmBot implements its effects
// as native libvips pipelines; sharp is also libvips, so the colour, geometry
// and compositing effects translate almost line for line. The two things sharp
// does not expose — `mapim` displacement remapping and ImageMagick's
// liquid-rescale — are implemented in JS in this file and in utils/frames.js.
//
// Every effect takes and returns a decoded frame set, so effects work
// identically on stills and animations.
//
// Effects that esmBot builds from bundled third-party artwork (gamexplain,
// scott, soos, spotify, reddit, homebrew, sonic, uncanny and the branded
// watermarks) are intentionally not ported: those need copyrighted image
// assets that do not belong in this repository. Where the effect can be
// generated instead of shipped — speech bubbles, vignettes, pride flags — it is
// drawn at runtime with SVG.
// ============================================================
const sharp = require('sharp');
const {
  ALLOWED_FONTS,
  decodeFrames,
  encodeFrames,
  mapFrames,
  rawImage,
  remapFrames,
  renderOutlinedText,
  renderText,
} = require('../utils/frames');

const SEPIA_MATRIX = [
  [0.3588, 0.7044, 0.1368],
  [0.2990, 0.5870, 0.1140],
  [0.2392, 0.4696, 0.0912],
];

const GENERATED_FRAMES = 30;
const SHORT_GENERATED_FRAMES = 15;
const MAX_WIDE_WIDTH = 4000;

// ------------------------------------------------------------
// Small helpers shared by several effects
// ------------------------------------------------------------

function clampInt(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.round(number)));
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

/**
 * Duplicate a still frame into an animation so effects that are inherently
 * animated (spin, squish, globe…) have frames to work with, matching esmBot's
 * "if nPages == 1, nPages = 30" behaviour.
 */
function ensureFrames(image, count, delay = 50) {
  if (image.animated && image.frames.length > 1) return image;
  const frames = [];
  for (let index = 0; index < count; index += 1) frames.push(image.frames[0]);
  return { ...image, frames, delays: frames.map(() => delay), animated: true, loop: 0 };
}

function splitCommaText(text) {
  // esmBot splits top/bottom text on an unescaped comma.
  const [top = '', bottom = ''] = String(text ?? '').split(/(?<!\\),/);
  return [top.replace(/\\,/g, ',').trim(), bottom.replace(/\\,/g, ',').trim()];
}

function requireText(params, message) {
  const text = String(params.text ?? '').trim();
  if (!text) throw new Error(message);
  return text;
}

/** Composite an overlay (an encoded image buffer) onto every frame. */
function compositeOnFrames(image, overlay, composite = {}) {
  return mapFrames(image, frame => frame.composite([{ input: overlay, ...composite }]));
}

// ------------------------------------------------------------
// Colour and filter effects
// ------------------------------------------------------------

async function perFrameFormat(image, encode) {
  return mapFrames(image, async frame => sharp(await encode(frame).toBuffer()));
}

const colourEffects = {
  blur: image => mapFrames(image, frame => frame.blur(5)),
  sharpen: image => mapFrames(image, frame => frame.sharpen({ sigma: 3 })),
  // Rec.709 luma, matching the sRGB -> B_W conversion libvips performs, but
  // applied as a recombination so the alpha channel survives.
  grayscale: image => mapFrames(image, frame => frame.recomb([
    [0.2126, 0.7152, 0.0722],
    [0.2126, 0.7152, 0.0722],
    [0.2126, 0.7152, 0.0722],
  ])),
  invert: image => mapFrames(image, frame => frame.negate({ alpha: false })),
  sepia: image => mapFrames(image, frame => frame.recomb(SEPIA_MATRIX)),
};

async function hueEffect(image, params) {
  const shift = clampInt(params.amount, -180, 180, 180);
  return mapFrames(image, frame => frame.modulate({ hue: shift }));
}

async function deepfryEffect(image) {
  // esmBot: (in * 1.3 - 76.5) * 1.5, then re-encode as quality-1 JPEG.
  const brightened = await mapFrames(image, frame => frame.linear(1.3 * 1.5, -76.5 * 1.5));
  return perFrameFormat(brightened, frame => frame.removeAlpha().jpeg({ quality: 1 }));
}

async function jpegEffect(image, params) {
  const quality = clampInt(params.amount, 1, 100, 1);
  return perFrameFormat(image, frame => frame.removeAlpha().jpeg({ quality }));
}

async function pixelateEffect(image) {
  // esmBot shrinks to 10% then scales back up with nearest-neighbour.
  const small = Math.max(1, Math.round(image.width * 0.1));
  const smallHeight = Math.max(1, Math.round(image.height * 0.1));
  return mapFrames(image, frame => frame
    .resize({ width: small, height: smallHeight, fit: 'fill' })
    .resize({ width: small * 10, height: smallHeight * 10, fit: 'fill', kernel: 'nearest' }));
}

async function vignetteEffect(image) {
  const { width, height } = image;
  const overlay = Buffer.from(
    `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <radialGradient id="v" cx="50%" cy="50%" r="75%">
          <stop offset="45%" stop-color="#000" stop-opacity="0"/>
          <stop offset="80%" stop-color="#000" stop-opacity="0.55"/>
          <stop offset="100%" stop-color="#000" stop-opacity="0.95"/>
        </radialGradient>
      </defs>
      <rect width="${width}" height="${height}" fill="url(#v)"/>
    </svg>`
  );
  return compositeOnFrames(image, overlay);
}

// Stripe definitions for the flags esmBot ships as PNGs. Drawing them keeps the
// effect available without vendoring artwork.
const FLAGS = {
  pride: ['#e40303', '#ff8c00', '#ffed00', '#008026', '#004dff', '#750787'],
  trans: ['#5bcefa', '#f5a9b8', '#ffffff', '#f5a9b8', '#5bcefa'],
  bi: ['#d60270', '#d60270', '#9b4f96', '#0038a8', '#0038a8'],
  pan: ['#ff218c', '#ffd800', '#21b1ff'],
  lesbian: ['#d52d00', '#ef7627', '#ff9a56', '#ffffff', '#d162a4', '#b55690', '#a30262'],
  nonbinary: ['#fcf434', '#ffffff', '#9c59d1', '#2c2c2c'],
  ace: ['#000000', '#a3a3a3', '#ffffff', '#800080'],
  aro: ['#3da542', '#a7d379', '#ffffff', '#a9a9a9', '#000000'],
  agender: ['#000000', '#bcc4c7', '#ffffff', '#b7f684', '#ffffff', '#bcc4c7', '#000000'],
  genderqueer: ['#b57edc', '#ffffff', '#4a8123'],
  genderfluid: ['#ff75a2', '#ffffff', '#be18d6', '#000000', '#333ebd'],
};

const FLAG_NAMES = Object.keys(FLAGS);

const FLAG_EMOJI = {
  '🏳️‍🌈': 'pride',
  '🏳️‍⚧️': 'trans',
  '🏳': 'pride',
};

async function flagEffect(image, params) {
  const raw = String(params.text ?? 'pride').trim().toLowerCase();
  const name = FLAGS[raw] ? raw : FLAG_EMOJI[raw] || (FLAGS[raw.replace(/\s+/g, '')] ? raw.replace(/\s+/g, '') : null);
  if (!name) {
    throw new Error(`Unknown flag. Pick one of: ${FLAG_NAMES.join(', ')}.`);
  }

  const stripes = FLAGS[name];
  const { width, height } = image;
  const bandHeight = height / stripes.length;
  const rects = stripes
    .map((colour, index) => `<rect x="0" y="${index * bandHeight}" width="${width}" height="${bandHeight + 1}" fill="${colour}"/>`)
    .join('');
  // esmBot halves the overlay's alpha so the subject stays visible.
  const overlay = Buffer.from(
    `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg"><g opacity="0.5">${rects}</g></svg>`
  );
  return compositeOnFrames(image, overlay);
}

// ------------------------------------------------------------
// Geometry effects
// ------------------------------------------------------------

const geometryEffects = {
  flip: image => mapFrames(image, frame => frame.flip()),
  flop: image => mapFrames(image, frame => frame.flop()),
};

/**
 * Mirror one half of the image onto the other.
 * `first` keeps the leading half (left/top); otherwise the trailing half wins.
 */
async function mirrorEffect(image, { vertical, first }) {
  const { width, height } = image;
  const half = vertical ? Math.floor(height / 2) : Math.floor(width / 2);
  if (half < 1) throw new Error('That image is too small to mirror.');

  // The trailing half starts here; with an odd size the middle row/column is
  // skipped, exactly as libvips' extract_area does in esmBot.
  const start = vertical ? height - half : width - half;

  if (vertical) {
    return remapFrames(image, (x, y) => {
      if (first) return [x, y < half ? y : 2 * half - 1 - y];
      return [x, y < half ? start + (half - 1 - y) : start + (y - half)];
    }, { extend: 'copy', outHeight: half * 2 });
  }

  return remapFrames(image, (x, y) => {
    if (first) return [x < half ? x : 2 * half - 1 - x, y];
    return [x < half ? start + (half - 1 - x) : start + (x - half), y];
  }, { extend: 'copy', outWidth: half * 2 });
}

async function rotateEffect(image, params) {
  const angle = clampNumber(params.amount, -360, 360, 90);
  return mapFrames(image, frame => frame.rotate(angle, { background: { r: 0, g: 0, b: 0, alpha: 0 } }));
}

async function cropEffect(image) {
  const size = Math.min(image.width, image.height);
  return mapFrames(image, frame => frame.resize({ width: size, height: size, fit: 'cover', position: 'centre' }));
}

async function wideEffect(image, params) {
  const amount = clampInt(params.amount, 1, 19, 19);
  const width = Math.min(MAX_WIDE_WIDTH, Math.max(1, image.width * amount));
  return mapFrames(image, frame => frame.resize({ width, height: image.height, fit: 'fill' }));
}

async function stretchEffect(image) {
  return mapFrames(image, frame => frame.resize({ width: 512, height: 512, fit: 'fill' }));
}

async function squishEffect(image) {
  const source = ensureFrames(image, GENERATED_FRAMES);
  const { width, height } = source;
  const step = 6.28 / source.frames.length;

  const frames = [];
  for (let index = 0; index < source.frames.length; index += 1) {
    const scaleX = Math.sin(index * step) / 4 + 0.75;
    const scaleY = Math.cos(index * step) / 4 + 0.75;
    const squished = await rawImage(source.frames[index], width, height)
      .resize({
        width: Math.max(1, Math.round(width * scaleX)),
        height: Math.max(1, Math.round(height * scaleY)),
        fit: 'fill',
      })
      .png({ compressionLevel: 0 })
      .toBuffer();
    const centred = await sharp({ create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite([{ input: squished, gravity: 'centre' }])
      .ensureAlpha()
      .raw()
      .toBuffer();
    frames.push(centred);
  }
  return { ...source, frames };
}

async function tileEffect(image) {
  const { width, height } = image;
  const tiledWidth = width * 5;
  const tiledHeight = height * 5;
  let scale = 800 / tiledHeight;
  if (scale > 1) scale = 800 / tiledWidth;
  const outWidth = scale < 1 ? Math.max(1, Math.round(tiledWidth * scale)) : tiledWidth;
  const outHeight = scale < 1 ? Math.max(1, Math.round(tiledHeight * scale)) : tiledHeight;

  return mapFrames(image, async frame => {
    const tilePng = await frame.png({ compressionLevel: 0 }).toBuffer();
    return sharp({ create: { width: tiledWidth, height: tiledHeight, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite([{ input: tilePng, tile: true }])
      .resize({ width: outWidth, height: outHeight, fit: 'fill' });
  });
}

async function wallEffect(image) {
  // Projective transform lifted from esmBot, which derived it from the classic
  // ImageMagick "wall" point set via OpenCV's getPerspectiveTransform.
  const T = [
    1.32996610e+00, -9.06795066e-02, -7.19995282e+01,
    -2.75152214e-01, 1.26875743e+00, -3.76041359e+01,
    -7.70327830e-04, -7.08433645e-04,
  ];

  const maxSide = Math.max(image.width, image.height);
  const tileScale = 128 / maxSide;
  const tileWidth = Math.max(1, Math.round(image.width * tileScale));
  const tileHeight = Math.max(1, Math.round(image.height * tileScale));
  const scaled = await mapFrames(image, frame => frame
    .resize({ width: tileWidth, height: tileHeight, fit: 'fill' })
    .resize({ width: tileWidth * 4, height: tileHeight * 4, fit: 'fill' }));

  return remapFrames(scaled, (x, y) => {
    const denominator = x * T[6] + y * T[7] + 1;
    return [
      (x * T[0] + y * T[1] + T[2]) / denominator,
      (x * T[3] + y * T[4] + T[5]) / denominator,
    ];
  }, { extend: 'repeat', outWidth: 512, outHeight: 512 });
}

// ------------------------------------------------------------
// Displacement effects
// ------------------------------------------------------------

async function circleEffect(image) {
  // esmBot maps the image into polar space, blurs radially, then maps back.
  const { width, height } = image;
  const centreX = width / 2;
  const centreY = height / 2;
  const maxRadius = Math.max(width, height) / (2 * 1.5);

  const rectangular = remapFrames(image, (x, y) => {
    const angle = (y / height) * Math.PI * 2;
    const radius = (x / width) * maxRadius;
    return [centreX + radius * Math.cos(angle), centreY + radius * Math.sin(angle)];
  }, { extend: 'copy' });

  const blurred = await mapFrames(rectangular, frame => frame.blur({ sigma: 6, precision: 'integer' }));

  return remapFrames(blurred, (x, y) => {
    const deltaX = x - centreX;
    const deltaY = y - centreY;
    const radius = Math.hypot(deltaX, deltaY);
    let angle = Math.atan2(deltaY, deltaX);
    if (angle < 0) angle += Math.PI * 2;
    return [(radius / maxRadius) * width, (angle / (Math.PI * 2)) * height];
  }, { extend: 'mirror' });
}

async function swirlEffect(image) {
  const { width, height } = image;
  const centreX = width / 2;
  const centreY = height / 2;
  const size = Math.min(width, height) / 2;

  return remapFrames(image, (x, y) => {
    const deltaX = x - centreX;
    const deltaY = y - centreY;
    const radius = Math.hypot(deltaX, deltaY);
    const falloff = 1 - radius / size;
    const twist = falloff * falloff * Math.PI;
    const angle = Math.atan2(deltaY, deltaX) + twist;
    return [centreX + radius * Math.cos(angle), centreY + radius * Math.sin(angle)];
  }, { extend: 'copy' });
}

/**
 * Radial push/pull, reproducing the effect esmBot gets from its bundled linear
 * explode/implode displacement maps. Both curves are linear in radius and fix
 * the rim in place, so nothing is sampled from outside the disc.
 *
 *   implode  sampled radius = r(2 - r/R)  — content moves toward the centre
 *   explode  sampled radius = r²/R        — content moves toward the rim
 */
function radialDistort(image, mode) {
  const { width, height } = image;
  const centreX = width / 2;
  const centreY = height / 2;
  const radius = Math.min(width, height) / 2;

  return remapFrames(image, (x, y) => {
    const deltaX = x - centreX;
    const deltaY = y - centreY;
    const distance = Math.hypot(deltaX, deltaY);
    if (distance >= radius || distance === 0) return [x, y];
    const normalised = distance / radius;
    const sampled = mode === 'implode' ? distance * (2 - normalised) : distance * normalised;
    const factor = sampled / distance;
    return [centreX + deltaX * factor, centreY + deltaY * factor];
  }, { extend: 'copy' });
}

/**
 * Wrap the image around a sphere and rotate it, one full turn per animation.
 * esmBot uses a pre-baked sphere map plus a diffuse/specular pass; the same
 * geometry and shading is computed here instead.
 */
async function globeEffect(image) {
  const size = Math.min(image.width, image.height);
  const source = ensureFrames(image, GENERATED_FRAMES);
  const frameCount = source.frames.length;
  const { width, height } = source;

  const uMap = new Float32Array(size * size);
  const vMap = new Float32Array(size * size);
  const shade = new Float32Array(size * size);
  const specular = new Float32Array(size * size);
  const inside = new Uint8Array(size * size);

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const index = y * size + x;
      const nx = (2 * x) / size - 1;
      const ny = (2 * y) / size - 1;
      const squared = nx * nx + ny * ny;
      if (squared > 1) continue;
      inside[index] = 1;
      const nz = Math.sqrt(1 - squared);
      // Longitude across the visible hemisphere covers the full texture width.
      uMap[index] = (Math.atan2(nx, nz) / Math.PI + 0.5) * width;
      vMap[index] = (Math.asin(Math.max(-1, Math.min(1, ny))) / Math.PI + 0.5) * height;
      shade[index] = 0.35 + 0.65 * Math.sqrt(nz);
      const highlightX = nx + 0.35;
      const highlightY = ny + 0.35;
      specular[index] = 90 * Math.exp(-((highlightX * highlightX + highlightY * highlightY) / 0.05));
    }
  }

  const frames = [];
  for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
    const sourceFrame = source.frames[frameIndex];
    const offset = (width * frameIndex) / frameCount;
    const output = Buffer.alloc(size * size * 4);

    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const index = y * size + x;
        const target = index * 4;
        if (!inside[index]) continue;

        let sampleX = (uMap[index] + offset) % width;
        if (sampleX < 0) sampleX += width;
        const sampleY = Math.min(height - 1, Math.max(0, vMap[index]));

        const x0 = Math.floor(sampleX);
        const y0 = Math.floor(sampleY);
        const x1 = (x0 + 1) % width;
        const y1 = Math.min(height - 1, y0 + 1);
        const fx = sampleX - x0;
        const fy = sampleY - y0;

        for (let channel = 0; channel < 3; channel += 1) {
          const top = sourceFrame[(y0 * width + x0) * 4 + channel] * (1 - fx) + sourceFrame[(y0 * width + x1) * 4 + channel] * fx;
          const bottom = sourceFrame[(y1 * width + x0) * 4 + channel] * (1 - fx) + sourceFrame[(y1 * width + x1) * 4 + channel] * fx;
          const value = (top * (1 - fy) + bottom * fy) * shade[index] + specular[index];
          output[target + channel] = value > 255 ? 255 : value | 0;
        }
        output[target + 3] = 255;
      }
    }
    frames.push(output);
  }

  return { ...source, frames, width: size, height: size };
}

async function spinEffect(image) {
  const source = ensureFrames(image, GENERATED_FRAMES);
  const { width, height } = source;
  const frameCount = source.frames.length;
  // Size the canvas to the rotated bounding box so the image neither clips at
  // 45° nor rescales between frames.
  const canvas = Math.ceil(Math.hypot(width, height));

  const frames = [];
  for (let index = 0; index < frameCount; index += 1) {
    const rotation = (360 * index) / frameCount;
    const rotated = await rawImage(source.frames[index], width, height)
      .rotate(rotation, { background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png({ compressionLevel: 0 })
      .toBuffer();
    const centred = await sharp({ create: { width: canvas, height: canvas, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite([{ input: rotated, gravity: 'centre' }])
      .ensureAlpha()
      .raw()
      .toBuffer();
    frames.push(centred);
  }
  return { ...source, frames, width: canvas, height: canvas };
}

// ------------------------------------------------------------
// Content-aware scale (magik)
// ------------------------------------------------------------

/**
 * Remove `count` low-energy vertical seams from an RGBA buffer.
 * A straight seam-carving implementation: Sobel-ish energy, then a dynamic
 * programming pass to find the cheapest top-to-bottom path.
 */
function carveVerticalSeams(pixels, width, height, count) {
  let current = pixels;
  let currentWidth = width;

  const energy = new Float32Array(width * height);
  const cost = new Float32Array(width * height);
  const parent = new Int32Array(width * height);

  for (let seam = 0; seam < count && currentWidth > 2; seam += 1) {
    // Energy: gradient magnitude of the luminance channel.
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < currentWidth; x += 1) {
        const left = (y * currentWidth + Math.max(0, x - 1)) * 4;
        const right = (y * currentWidth + Math.min(currentWidth - 1, x + 1)) * 4;
        const up = (Math.max(0, y - 1) * currentWidth + x) * 4;
        const down = (Math.min(height - 1, y + 1) * currentWidth + x) * 4;
        const dx = (current[left] - current[right]) + (current[left + 1] - current[right + 1]) + (current[left + 2] - current[right + 2]);
        const dy = (current[up] - current[down]) + (current[up + 1] - current[down + 1]) + (current[up + 2] - current[down + 2]);
        energy[y * currentWidth + x] = Math.abs(dx) + Math.abs(dy);
      }
    }

    for (let x = 0; x < currentWidth; x += 1) cost[x] = energy[x];
    for (let y = 1; y < height; y += 1) {
      for (let x = 0; x < currentWidth; x += 1) {
        const row = y * currentWidth;
        const previous = row - currentWidth;
        let best = cost[previous + x];
        let bestX = x;
        if (x > 0 && cost[previous + x - 1] < best) {
          best = cost[previous + x - 1];
          bestX = x - 1;
        }
        if (x < currentWidth - 1 && cost[previous + x + 1] < best) {
          best = cost[previous + x + 1];
          bestX = x + 1;
        }
        cost[row + x] = energy[row + x] + best;
        parent[row + x] = bestX;
      }
    }

    let seamX = 0;
    const lastRow = (height - 1) * currentWidth;
    for (let x = 1; x < currentWidth; x += 1) {
      if (cost[lastRow + x] < cost[lastRow + seamX]) seamX = x;
    }

    const nextWidth = currentWidth - 1;
    const next = Buffer.alloc(nextWidth * height * 4);
    for (let y = height - 1; y >= 0; y -= 1) {
      const sourceRow = y * currentWidth * 4;
      const targetRow = y * nextWidth * 4;
      current.copy(next, targetRow, sourceRow, sourceRow + seamX * 4);
      current.copy(next, targetRow + seamX * 4, sourceRow + (seamX + 1) * 4, sourceRow + currentWidth * 4);
      if (y > 0) seamX = parent[y * currentWidth + seamX];
    }

    current = next;
    currentWidth = nextWidth;
  }

  return { pixels: current, width: currentWidth };
}

async function transposeFrame(pixels, width, height) {
  const output = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const from = (y * width + x) * 4;
      const to = (x * height + y) * 4;
      output[to] = pixels[from];
      output[to + 1] = pixels[from + 1];
      output[to + 2] = pixels[from + 2];
      output[to + 3] = pixels[from + 3];
    }
  }
  return output;
}

async function magikEffect(image) {
  // Seam carving is O(seams × pixels), so cap the working size and frame count.
  const working = 200;
  const scaled = await mapFrames(
    { ...image, frames: image.frames.slice(0, 12), delays: image.delays.slice(0, 12) },
    frame => frame.resize({ width: working, height: working, fit: 'fill' })
  );

  const targetWidth = Math.round(working / 2);
  const frames = [];
  for (const frame of scaled.frames) {
    // Carve columns, transpose, carve again, transpose back — the same
    // shrink-then-restore trick behind ImageMagick's liquid rescale.
    const carvedColumns = carveVerticalSeams(Buffer.from(frame), working, working, working - targetWidth);
    const transposed = await transposeFrame(carvedColumns.pixels, carvedColumns.width, working);
    const carvedRows = carveVerticalSeams(transposed, working, carvedColumns.width, working - targetWidth);
    const restored = await transposeFrame(carvedRows.pixels, carvedRows.width, carvedColumns.width);

    const stretched = await sharp(restored, { raw: { width: carvedColumns.width, height: carvedRows.width, channels: 4 } })
      .resize({ width: image.width, height: image.height, fit: 'fill' })
      .ensureAlpha()
      .raw()
      .toBuffer();
    frames.push(stretched);
  }

  return { ...scaled, frames, width: image.width, height: image.height };
}

// ------------------------------------------------------------
// Text effects
// ------------------------------------------------------------

async function memeEffect(image, params) {
  const raw = requireText(params, 'Provide the meme text. Separate the top and bottom halves with a comma.');
  const [topRaw, bottomRaw] = splitCommaText(raw);
  const caseSensitive = params.caseSensitive === true;
  const top = caseSensitive ? topRaw : topRaw.toUpperCase();
  const bottom = caseSensitive ? bottomRaw : bottomRaw.toUpperCase();
  const font = params.font || 'impact';

  const { width, height } = image;
  const size = width / 9;
  const overlays = [];

  if (top) {
    const rendered = await renderOutlinedText(top, { size, width, font, radius: size / 18 });
    overlays.push({ input: rendered.buffer, left: Math.round((width - rendered.width) / 2), top: 0 });
  }
  if (bottom) {
    const rendered = await renderOutlinedText(bottom, { size, width, font, radius: size / 18 });
    overlays.push({
      input: rendered.buffer,
      left: Math.round((width - rendered.width) / 2),
      top: Math.max(0, height - rendered.height),
    });
  }
  if (!overlays.length) throw new Error('Provide the meme text. Separate the top and bottom halves with a comma.');

  return mapFrames(image, frame => frame.composite(overlays));
}

async function motivateEffect(image, params) {
  const raw = requireText(params, 'Provide the poster text. Separate the title and subtitle with a comma.');
  const [top, bottom] = splitCommaText(raw);
  const font = params.font || 'times';

  const { width, height } = image;
  const size = width / 5;
  const textWidth = width - Math.floor(width / 25) * 2;

  const borderSize = Math.max(2, Math.round(width / 66));
  const innerBorder = Math.max(1, Math.round(borderSize * 0.5));
  const sidePadding = Math.round(height * 0.4);
  const verticalPadding = Math.round(width / 8);

  const framedWidth = width + borderSize * 2 + innerBorder * 2 + sidePadding;
  const framedHeight = height + borderSize * 2 + innerBorder * 2 + verticalPadding;

  const captions = [];
  if (top) {
    const rendered = await renderText(top, { size, width: textWidth, font, foreground: 'white', align: 'centre' });
    captions.push({ ...rendered, pad: Math.round(size / 4) });
  }
  if (bottom) {
    const rendered = await renderText(bottom, { size: size * 0.4, width: textWidth, font, foreground: 'white', align: 'centre' });
    captions.push({ ...rendered, pad: Math.round((size * 0.4) / 4) });
  }
  if (!captions.length) throw new Error('Provide the poster text. Separate the title and subtitle with a comma.');

  const captionHeight = captions.reduce((total, caption) => total + caption.height + caption.pad, 0);
  const outHeight = framedHeight + captionHeight;

  return mapFrames(image, async frame => {
    const framed = await frame
      .extend({ top: borderSize, bottom: borderSize, left: borderSize, right: borderSize, background: '#000000' })
      .extend({ top: innerBorder, bottom: innerBorder, left: innerBorder, right: innerBorder, background: '#ffffff' })
      .png({ compressionLevel: 0 })
      .toBuffer();

    const overlays = [{
      input: framed,
      left: Math.round(sidePadding / 2),
      top: Math.round(verticalPadding / 2),
    }];

    let cursor = framedHeight;
    for (const caption of captions) {
      overlays.push({
        input: caption.buffer,
        left: Math.max(0, Math.round((framedWidth - caption.width) / 2)),
        top: cursor,
      });
      cursor += caption.height + caption.pad;
    }

    return sharp({ create: { width: framedWidth, height: outHeight, channels: 4, background: '#000000' } })
      .composite(overlays);
  });
}

/**
 * esmBot's `caption`: a white bar above the image with large centred text.
 * `caption2` puts a smaller, left-aligned bar below instead.
 */
async function captionEffect(image, params) {
  const text = requireText(params, 'Provide some caption text.');
  const second = params.style === 'caption2';
  const bottom = second ? params.position !== 'top' : params.position === 'bottom';
  const font = params.font || (second ? 'helvetica' : 'futura');

  const { width, height } = image;
  const size = second ? width / 13 : width / 10;
  const textWidth = width - Math.floor(width / 25) * 2;

  const rendered = await renderText(text, {
    size,
    width: textWidth,
    font,
    foreground: 'black',
    align: second ? 'left' : 'centre',
  });

  const barHeight = rendered.height + Math.round(size);
  const bar = await sharp({ create: { width, height: barHeight, channels: 4, background: '#ffffff' } })
    .composite([{
      input: rendered.buffer,
      left: second ? Math.floor(width / 25) : Math.max(0, Math.round((width - rendered.width) / 2)),
      top: Math.max(0, Math.round((barHeight - rendered.height) / 2)),
    }])
    .png({ compressionLevel: 0 })
    .toBuffer();

  return mapFrames(image, async frame => {
    const framePng = await frame.flatten({ background: '#ffffff' }).png({ compressionLevel: 0 }).toBuffer();
    return sharp({ create: { width, height: height + barHeight, channels: 4, background: '#ffffff' } })
      .composite([
        { input: bar, left: 0, top: bottom ? height : 0 },
        { input: framePng, left: 0, top: bottom ? 0 : barHeight },
      ]);
  });
}

async function whisperEffect(image, params) {
  const text = requireText(params, 'Provide some text to overlay.');
  const { width, height } = image;
  const size = width / 6;

  const rendered = await renderOutlinedText(text, { size, width, font: 'serif', radius: size / 24 });
  const overlay = {
    input: rendered.buffer,
    left: Math.round((width - rendered.width) / 2),
    top: Math.round((height - rendered.height) / 2),
  };
  return mapFrames(image, frame => frame.composite([overlay]));
}

async function snapchatEffect(image, params) {
  const text = requireText(params, 'Provide some text to overlay.');
  const position = clampNumber(params.amount, 0, 1, 0.565);

  const { width, height } = image;
  const size = width / 20;
  const textWidth = width - Math.floor(width / 25) * 2;

  const rendered = await renderText(text, { size, width: textWidth, font: 'helvetica', foreground: 'white', align: 'centre' });
  const barHeight = rendered.height + Math.round(width / 25);
  const bar = await sharp({
    create: { width, height: barHeight, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0.7 } },
  })
    .composite([{
      input: rendered.buffer,
      left: Math.max(0, Math.round((width - rendered.width) / 2)),
      top: Math.max(0, Math.round((barHeight - rendered.height) / 2)),
    }])
    .png({ compressionLevel: 0 })
    .toBuffer();

  const top = Math.round((height - barHeight) * position);
  return mapFrames(image, frame => frame.composite([{ input: bar, left: 0, top: Math.max(0, top) }]));
}

async function speechBubbleEffect(image, params) {
  const { width, height } = image;
  const scale = clampNumber(params.amount, 0.05, 1, 0.2);
  const bubbleHeight = Math.max(8, Math.round(height * scale));
  const flip = params.flip === true;
  const bottom = params.bottom === true;
  const transparent = params.alpha === true;

  // A rounded speech bubble with a tail, drawn to fill the requested band.
  const tailX = flip ? width * 0.72 : width * 0.2;
  const bubble = Buffer.from(
    `<svg width="${width}" height="${bubbleHeight}" xmlns="http://www.w3.org/2000/svg">
      <path fill="#ffffff" d="
        M ${width * 0.02} ${bubbleHeight * 0.02}
        H ${width * 0.98}
        V ${bubbleHeight * 0.62}
        Q ${width * 0.98} ${bubbleHeight * 0.74} ${width * 0.9} ${bubbleHeight * 0.74}
        H ${tailX + width * 0.1}
        L ${tailX} ${bubbleHeight * 0.99}
        L ${tailX + width * 0.02} ${bubbleHeight * 0.74}
        H ${width * 0.1}
        Q ${width * 0.02} ${bubbleHeight * 0.74} ${width * 0.02} ${bubbleHeight * 0.62}
        Z"/>
    </svg>`
  );

  const bubblePng = await sharp(bubble).flip(bottom).png().toBuffer();
  const top = bottom ? height - bubbleHeight : 0;

  if (!transparent) {
    return mapFrames(image, frame => frame.composite([{ input: bubblePng, left: 0, top }]));
  }

  // Transparent mode: punch the bubble out of the image's alpha channel.
  const alpha = await sharp({ create: { width, height, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } } })
    .composite([{ input: bubblePng, left: 0, top, blend: 'dest-out' }])
    .extractChannel('alpha')
    .raw()
    .toBuffer();

  return mapFrames(image, async frame => {
    const { data } = await frame.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const output = Buffer.from(data);
    for (let index = 0; index < alpha.length; index += 1) {
      const target = index * 4 + 3;
      output[target] = Math.min(output[target], alpha[index]);
    }
    return sharp(output, { raw: { width, height, channels: 4 } });
  });
}

async function watermarkEffect(image, params) {
  const text = requireText(params, 'Provide the watermark text.');
  const gravityMap = {
    'top-left': 'northwest',
    top: 'north',
    'top-right': 'northeast',
    left: 'west',
    centre: 'centre',
    center: 'centre',
    right: 'east',
    'bottom-left': 'southwest',
    bottom: 'south',
    'bottom-right': 'southeast',
  };
  const gravity = gravityMap[String(params.position || 'bottom-right').toLowerCase()] || 'southeast';
  const opacity = clampNumber(params.amount, 0.05, 1, 0.6);

  const { width } = image;
  const size = Math.max(10, Math.round(width / 16));
  const rendered = await renderOutlinedText(text, {
    size,
    width: Math.round(width * 0.9),
    font: 'helvetica',
    radius: Math.max(1, size / 22),
  });

  const faded = await sharp(rendered.buffer)
    .ensureAlpha()
    .composite([{
      input: Buffer.from([255, 255, 255, Math.round(opacity * 255)]),
      raw: { width: 1, height: 1, channels: 4 },
      tile: true,
      blend: 'dest-in',
    }])
    .png()
    .toBuffer();

  return mapFrames(image, frame => frame.composite([{ input: faded, gravity }]));
}

// Caption-bar detection tuning. A bar is a run of rows where nearly every
// pixel is close to pure white or pure black.
const BAR_UNIFORM_THRESHOLD = 0.8;
const BAR_MAX_CROP_FRACTION = 0.4;
const BAR_MIN_HEIGHT = 12;
// Bold anti-aliased glyphs briefly dip a row below the uniformity threshold
// even inside the bar, so bridge short dips instead of stopping at the first
// failing row. `crop` only advances on a pass, so a genuine boundary rolls back
// to the last confirmed-flat row.
const BAR_FAIL_TOLERANCE = 3;

function scanBarEdge(uniformity, maxCrop, indexAt) {
  let crop = 0;
  let failRun = 0;
  for (let offset = 0; offset < maxCrop; offset += 1) {
    if (uniformity[indexAt(offset)] >= BAR_UNIFORM_THRESHOLD) {
      failRun = 0;
      crop = offset + 1;
    } else if (++failRun >= BAR_FAIL_TOLERANCE) {
      break;
    }
  }
  return crop;
}

/**
 * Trim solid caption bars off the top and bottom.
 *
 * esmBot only strips a light bar from the top; this also handles dark bars and
 * bottom bars, and requires a run of near-uniform rows rather than trusting the
 * leftmost few pixels. `amount` widens or narrows how close to pure white/black
 * a pixel has to be.
 */
async function uncaptionEffect(image, params) {
  const sensitivity = clampNumber(params.amount, 0, 1, 0.5);
  const slack = Math.round(40 * sensitivity);
  const nearWhite = 255 - slack;
  const nearBlack = slack;

  const { width, height } = image;
  // A caption bar occupies the same rows on every frame, so one pass is enough.
  const first = image.frames[0];

  const uniformity = new Array(height);
  for (let y = 0; y < height; y += 1) {
    let flat = 0;
    const rowStart = y * width * 4;
    for (let x = 0; x < width; x += 1) {
      const offset = rowStart + x * 4;
      const red = first[offset];
      const green = first[offset + 1];
      const blue = first[offset + 2];
      const light = red >= nearWhite && green >= nearWhite && blue >= nearWhite;
      const dark = red <= nearBlack && green <= nearBlack && blue <= nearBlack;
      if (light || dark) flat += 1;
    }
    uniformity[y] = flat / width;
  }

  const maxCrop = Math.floor(height * BAR_MAX_CROP_FRACTION);
  let top = scanBarEdge(uniformity, maxCrop, offset => offset);
  let bottom = scanBarEdge(uniformity, maxCrop, offset => height - 1 - offset);
  if (top < BAR_MIN_HEIGHT) top = 0;
  if (bottom < BAR_MIN_HEIGHT) bottom = 0;

  if (!top && !bottom) {
    throw new Error('No caption bar found — that image looks uncropped already. Try raising `amount` if the bar is off-white.');
  }

  const newHeight = height - top - bottom;
  if (newHeight < 8) throw new Error('That would remove almost the whole image; nothing was cropped.');

  const notes = [];
  if (top) notes.push(`${top}px trimmed from the top`);
  if (bottom) notes.push(`${bottom}px trimmed from the bottom`);

  return {
    ...image,
    height: newHeight,
    notes,
    frames: image.frames.map(frame => Buffer.from(frame.subarray(top * width * 4, (top + newHeight) * width * 4))),
  };
}

// ------------------------------------------------------------
// Animation effects
// ------------------------------------------------------------

async function reverseEffect(image) {
  if (image.frames.length < 2) throw new Error('That image is not animated, so there is nothing to reverse.');
  return { ...image, frames: [...image.frames].reverse(), delays: [...image.delays].reverse() };
}

async function speedEffect(image, params, { slow = false } = {}) {
  if (image.frames.length < 2) throw new Error('That image is not animated, so its speed cannot be changed.');
  const multiplier = clampNumber(params.amount, 1, 100, 2);

  if (slow) {
    return { ...image, delays: image.delays.map(delay => Math.min(3000, Math.round(delay * multiplier))) };
  }

  const delays = image.delays.map(delay => Math.round(delay / multiplier));
  if (delays.every(delay => delay >= 20)) return { ...image, delays };

  // Below the 20ms floor a GIF cannot go any faster, so drop frames instead —
  // the same fallback esmBot uses.
  const frames = [];
  const keptDelays = [];
  for (let position = 0; position < image.frames.length; position += multiplier) {
    const index = Math.floor(position);
    frames.push(image.frames[index]);
    keptDelays.push(image.delays[index]);
  }
  if (frames.length < 2) throw new Error('That would leave fewer than two frames. Try a smaller multiplier.');
  return { ...image, frames, delays: keptDelays };
}

async function freezeEffect(image, params) {
  if (image.frames.length < 2) throw new Error('That image is not animated, so it cannot be frozen.');
  const endFrame = Number.isFinite(Number(params.amount)) ? clampInt(params.amount, 1, image.frames.length, image.frames.length) : image.frames.length;
  return {
    ...image,
    frames: image.frames.slice(0, endFrame),
    delays: image.delays.slice(0, endFrame),
    loop: 1,
  };
}

async function unfreezeEffect(image) {
  if (image.frames.length < 2) throw new Error('That image is not animated, so it cannot be unfrozen.');
  return { ...image, loop: 0 };
}

async function bounceEffect(image) {
  const source = ensureFrames(image, SHORT_GENERATED_FRAMES);
  const { width, height } = source;
  const frameCount = source.frames.length;
  const step = Math.PI / frameCount;
  const halfHeight = Math.floor(height / 2);
  const outHeight = height + halfHeight;

  const frames = [];
  for (let index = 0; index < frameCount; index += 1) {
    const offset = Math.round(halfHeight * (-Math.sin(index * step) + 1));
    const framePng = await rawImage(source.frames[index], width, height).png({ compressionLevel: 0 }).toBuffer();
    const composed = await sharp({ create: { width, height: outHeight, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite([{ input: framePng, left: 0, top: Math.min(halfHeight, Math.max(0, offset)) }])
      .ensureAlpha()
      .raw()
      .toBuffer();
    frames.push(composed);
  }
  return { ...source, frames, height: outHeight };
}

async function fadeEffect(image, params) {
  const source = ensureFrames(image, GENERATED_FRAMES);
  const frameCount = source.frames.length;
  const useAlpha = params.alpha === true;

  const frames = [];
  for (let index = 0; index < frameCount; index += 1) {
    const multiplier = frameCount === 1 ? 1 : index / (frameCount - 1);
    const frame = source.frames[index];
    const output = Buffer.from(frame);
    for (let offset = 0; offset < output.length; offset += 4) {
      if (useAlpha) {
        output[offset + 3] = (output[offset + 3] * multiplier) | 0;
      } else {
        output[offset] = (output[offset] * multiplier) | 0;
        output[offset + 1] = (output[offset + 1] * multiplier) | 0;
        output[offset + 2] = (output[offset + 2] * multiplier) | 0;
      }
    }
    frames.push(output);
  }
  return { ...source, frames, loop: 1 };
}

async function slideEffect(image, params) {
  const source = ensureFrames(image, SHORT_GENERATED_FRAMES);
  const { width, height } = source;
  const frameCount = source.frames.length;
  const vertical = params.vertical === true;
  const direction = params.reverse === true ? -1 : 1;

  // A plain integer roll, so no interpolation and no per-frame map allocation.
  const frames = source.frames.map((frame, index) => {
    const shift = Math.round(((vertical ? height : width) * direction * index) / frameCount);
    const output = Buffer.alloc(width * height * 4);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const sourceX = vertical ? x : (((x + shift) % width) + width) % width;
        const sourceY = vertical ? (((y + shift) % height) + height) % height : y;
        frame.copy(output, (y * width + x) * 4, (sourceY * width + sourceX) * 4, (sourceY * width + sourceX) * 4 + 4);
      }
    }
    return output;
  });
  return { ...source, frames };
}

async function toGifEffect(image) {
  return image;
}

// ------------------------------------------------------------
// Effect registry
// ------------------------------------------------------------

const TEXT_PARAM = { text: { required: true } };
const AMOUNT = (min, max, fallback, description) => ({ amount: { min, max, default: fallback, description } });

/**
 * Each entry describes one effect:
 *   aliases      extra names usable as prefix commands
 *   category     grouping used by /image and /help
 *   params       which of the generic options the effect reads
 *   alwaysGif    force an animated result even for a still input
 *   maxSize      override the working resolution
 *   run          (image, params) => image
 */
const EFFECTS = {
  // -- Colour ------------------------------------------------
  blur: { description: 'Blurs an image', category: 'colour', run: colourEffects.blur },
  sharpen: { description: 'Sharpens an image', aliases: ['unblur'], category: 'colour', run: colourEffects.sharpen },
  grayscale: { description: 'Adds a grayscale filter', aliases: ['gray', 'greyscale', 'grey', 'bw'], category: 'colour', run: colourEffects.grayscale },
  invert: { description: 'Inverts an image', aliases: ['inverse', 'negate', 'negative'], category: 'colour', run: colourEffects.invert },
  sepia: { description: 'Adds a sepia filter', category: 'colour', run: colourEffects.sepia },
  hue: {
    description: 'Hue shifts an image',
    aliases: ['hueshift', 'recolor'],
    category: 'colour',
    params: AMOUNT(-180, 180, 180, 'Degrees to shift the hue by'),
    run: hueEffect,
  },
  deepfry: { description: 'Deep-fries an image', aliases: ['fry', 'nuke', 'df'], category: 'colour', run: deepfryEffect },
  jpeg: {
    description: 'Adds JPEG compression artefacts',
    aliases: ['jpg', 'morejpeg', 'needsmorejpeg', 'jpegify'],
    category: 'colour',
    params: AMOUNT(1, 100, 1, 'JPEG quality (1 is worst)'),
    run: jpegEffect,
  },
  pixelate: { description: 'Pixelates an image', aliases: ['pixel', 'small'], category: 'colour', run: pixelateEffect },
  vignette: { description: 'Adds a vignette to an image', category: 'colour', run: vignetteEffect },
  flag: {
    description: 'Overlays a pride flag onto an image',
    category: 'colour',
    params: { text: { required: false, description: `Flag name (${FLAG_NAMES.join(', ')})` } },
    run: flagEffect,
  },

  // -- Geometry ----------------------------------------------
  flip: { description: 'Flips an image vertically', aliases: ['upsidedown'], category: 'geometry', run: geometryEffects.flip },
  flop: { description: 'Flips an image horizontally', category: 'geometry', run: geometryEffects.flop },
  haah: { description: 'Mirrors the left side of an image onto the right', aliases: ['mirror2', 'magik4'], category: 'geometry', run: image => mirrorEffect(image, { vertical: false, first: true }) },
  waaw: { description: 'Mirrors the right side of an image onto the left', aliases: ['mirror', 'magik3'], category: 'geometry', run: image => mirrorEffect(image, { vertical: false, first: false }) },
  woow: { description: 'Mirrors the top of an image onto the bottom', aliases: ['mirror3', 'magik5'], category: 'geometry', run: image => mirrorEffect(image, { vertical: true, first: true }) },
  hooh: { description: 'Mirrors the bottom of an image onto the top', aliases: ['mirror4', 'magik6'], category: 'geometry', run: image => mirrorEffect(image, { vertical: true, first: false }) },
  rotate: {
    description: 'Rotates an image',
    category: 'geometry',
    params: AMOUNT(-360, 360, 90, 'Rotation angle in degrees'),
    run: rotateEffect,
  },
  crop: { description: 'Crops an image to a square', category: 'geometry', run: cropEffect },
  wide: {
    description: 'Stretches an image horizontally',
    aliases: ['w19', 'wide19'],
    category: 'geometry',
    params: AMOUNT(1, 19, 19, 'How many times wider to make it'),
    run: wideEffect,
  },
  stretch: { description: 'Stretches an image to a 1:1 aspect ratio', aliases: ['aspect', 'ratio'], category: 'geometry', run: stretchEffect },
  squish: { description: 'Squishes an image in and out', category: 'geometry', alwaysGif: true, run: squishEffect },
  tile: { description: 'Tiles an image into a 5x5 grid', category: 'geometry', run: tileEffect },
  wall: { description: 'Repeats an image into a slanted wall', category: 'geometry', run: wallEffect },

  // -- Distortion --------------------------------------------
  circle: { description: 'Applies a radial blur effect', aliases: ['cblur', 'radial', 'radialblur'], category: 'distortion', run: circleEffect },
  swirl: { description: 'Swirls an image', aliases: ['whirl'], category: 'distortion', run: swirlEffect },
  explode: { description: 'Explodes an image outwards', aliases: ['exp'], category: 'distortion', run: image => radialDistort(image, 'explode') },
  implode: { description: 'Implodes an image inwards', aliases: ['imp'], category: 'distortion', run: image => radialDistort(image, 'implode') },
  globe: { description: 'Wraps an image around a spinning globe', aliases: ['sphere'], category: 'distortion', alwaysGif: true, maxSize: 320, run: globeEffect },
  spin: { description: 'Spins an image around', category: 'distortion', alwaysGif: true, run: spinEffect },
  magik: {
    description: 'Content-aware scales an image (seam carving)',
    aliases: ['magic', 'imagemagik', 'imagemagick', 'cas', 'contentawarescale'],
    category: 'distortion',
    maxSize: 320,
    run: magikEffect,
  },

  // -- Text --------------------------------------------------
  meme: {
    description: 'Adds Impact-style top and bottom meme text',
    category: 'text',
    params: { ...TEXT_PARAM, font: { choices: ALLOWED_FONTS, default: 'impact' } },
    run: memeEffect,
  },
  motivate: {
    description: 'Turns an image into a motivational poster',
    aliases: ['motivational', 'motiv', 'poster', 'demotivate', 'demotivational'],
    category: 'text',
    params: { ...TEXT_PARAM, font: { choices: ALLOWED_FONTS, default: 'times' } },
    run: motivateEffect,
  },
  caption: {
    description: 'Adds a white caption bar above an image',
    category: 'text',
    params: { ...TEXT_PARAM, font: { choices: ALLOWED_FONTS, default: 'futura' } },
    run: captionEffect,
  },
  caption2: {
    description: 'Adds a small caption bar below an image (iFunny style)',
    aliases: ['ifunny', 'caption-bottom'],
    category: 'text',
    params: { ...TEXT_PARAM, font: { choices: ALLOWED_FONTS, default: 'helvetica' } },
    run: (image, params) => captionEffect(image, { ...params, style: 'caption2' }),
  },
  whisper: { description: 'Overlays large centred text', category: 'text', params: TEXT_PARAM, run: whisperEffect },
  snapchat: {
    description: 'Adds a Snapchat-style caption bar',
    aliases: ['snap'],
    category: 'text',
    params: { ...TEXT_PARAM, ...AMOUNT(0, 1, 0.565, 'Vertical position from 0 (top) to 1 (bottom)') },
    run: snapchatEffect,
  },
  speechbubble: {
    description: 'Adds a speech bubble to an image',
    aliases: ['speech', 'bubble'],
    category: 'text',
    params: AMOUNT(0.05, 1, 0.2, 'Bubble height as a fraction of the image'),
    run: speechBubbleEffect,
  },
  watermark: {
    description: 'Adds a text watermark',
    aliases: ['wm'],
    category: 'text',
    params: { ...TEXT_PARAM, ...AMOUNT(0.05, 1, 0.6, 'Watermark opacity') },
    run: watermarkEffect,
  },
  uncaption: {
    description: 'Removes a caption bar from the top of an image',
    aliases: ['uncap'],
    category: 'text',
    params: AMOUNT(0, 1, 0.5, 'How light the bar must be to count as a caption'),
    run: uncaptionEffect,
  },

  // -- Animation ---------------------------------------------
  reverse: { description: 'Reverses an animation', aliases: ['backwards'], category: 'animation', alwaysGif: true, run: reverseEffect },
  speed: {
    description: 'Speeds an animation up',
    aliases: ['speedup', 'fast', 'faster'],
    category: 'animation',
    alwaysGif: true,
    params: AMOUNT(1, 100, 2, 'Speed multiplier'),
    run: speedEffect,
  },
  slow: {
    description: 'Slows an animation down',
    aliases: ['slowdown', 'slower'],
    category: 'animation',
    alwaysGif: true,
    params: AMOUNT(1, 100, 2, 'Slowdown multiplier'),
    run: (image, params) => speedEffect(image, params, { slow: true }),
  },
  freeze: {
    description: 'Makes an animation play only once',
    aliases: ['noloop', 'once'],
    category: 'animation',
    alwaysGif: true,
    params: AMOUNT(1, 300, null, 'Frame to stop on'),
    run: freezeEffect,
  },
  unfreeze: { description: 'Makes an animation loop again', category: 'animation', alwaysGif: true, run: unfreezeEffect },
  bounce: { description: 'Makes an image bounce up and down', aliases: ['bouncy'], category: 'animation', alwaysGif: true, run: bounceEffect },
  fade: { description: 'Fades an image in', aliases: ['fadein'], category: 'animation', alwaysGif: true, run: fadeEffect },
  slide: { description: 'Slides an image in a direction', aliases: ['shift'], category: 'animation', alwaysGif: true, run: slideEffect },
  gif: { description: 'Converts an image into a GIF', aliases: ['gifify', 'tgif'], category: 'animation', alwaysGif: true, run: toGifEffect },
};

// name/alias -> canonical name
const EFFECT_LOOKUP = new Map();
for (const [name, effect] of Object.entries(EFFECTS)) {
  EFFECT_LOOKUP.set(name, name);
  for (const alias of effect.aliases || []) EFFECT_LOOKUP.set(alias, name);
}

function resolveEffectName(input) {
  return EFFECT_LOOKUP.get(String(input || '').trim().toLowerCase()) || null;
}

function getEffect(input) {
  const name = resolveEffectName(input);
  if (!name) return null;
  return { name, ...EFFECTS[name] };
}

function listEffects() {
  return Object.entries(EFFECTS).map(([name, effect]) => ({ name, ...effect }));
}

/**
 * Run an effect end to end.
 *
 * @param {Buffer} buffer source image data
 * @param {string} effectName effect name or alias
 * @param {object} [params] `{ text, amount, font, ... }`
 * @param {object} [options] `{ maxSize, maxFrames, format }`
 * @returns {Promise<{buffer: Buffer, format: string, frames: number, width: number, height: number, truncated: boolean}>}
 */
async function applyEffect(buffer, effectName, params = {}, options = {}) {
  const effect = getEffect(effectName);
  if (!effect) throw new Error(`Unknown effect \`${String(effectName).slice(0, 40)}\`.`);

  const decoded = await decodeFrames(buffer, {
    maxSize: options.maxSize ?? effect.maxSize ?? undefined,
    maxFrames: options.maxFrames,
    flatten: effect.flatten,
  });

  const result = await effect.run(decoded, params);

  let format = options.format;
  if (!format) {
    if (result.frames.length > 1) format = 'gif';
    else if (effect.alwaysGif) format = 'gif';
    else format = 'png';
  }

  const encoded = await encodeFrames(result, { format });
  return {
    buffer: encoded.buffer,
    format: encoded.format,
    frames: result.frames.length,
    width: result.width,
    height: result.height,
    truncated: !!decoded.truncated,
    notes: result.notes || [],
  };
}

module.exports = {
  ALLOWED_FONTS,
  EFFECTS,
  FLAG_NAMES,
  applyEffect,
  getEffect,
  listEffects,
  resolveEffectName,
};
