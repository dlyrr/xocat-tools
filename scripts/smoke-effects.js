// ============================================================
// Effect smoke test
// ------------------------------------------------------------
// Runs every registered image effect against a still PNG and an animated GIF
// and reports the output size/format, so a broken pipeline shows up without
// needing a live Discord connection.
//
//   node scripts/smoke-effects.js [--write <dir>] [effect ...]
// ============================================================
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { applyEffect, listEffects } = require('../src/services/imageEffects');

async function buildStill() {
  // A recognisable test pattern: coloured quadrants plus a diagonal.
  const svg = `<svg width="320" height="240" xmlns="http://www.w3.org/2000/svg">
    <rect width="160" height="120" fill="#e05252"/>
    <rect x="160" width="160" height="120" fill="#52a0e0"/>
    <rect y="120" width="160" height="120" fill="#5fc46b"/>
    <rect x="160" y="120" width="160" height="120" fill="#e0c052"/>
    <circle cx="160" cy="120" r="70" fill="#20202a"/>
    <text x="160" y="132" font-size="42" text-anchor="middle" fill="#ffffff" font-family="DejaVu Sans">test</text>
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

async function buildAnimation() {
  const frames = [];
  for (let index = 0; index < 6; index += 1) {
    const svg = `<svg width="160" height="120" xmlns="http://www.w3.org/2000/svg">
      <rect width="160" height="120" fill="#1b1b26"/>
      <circle cx="${20 + index * 24}" cy="60" r="18" fill="#ff8c42"/>
    </svg>`;
    frames.push(await sharp(Buffer.from(svg)).png().toBuffer());
  }
  return sharp(frames, { join: { animated: true } }).gif({ delay: frames.map(() => 80), loop: 0 }).toBuffer();
}

const PARAMS = {
  meme: { text: 'top text, bottom text' },
  motivate: { text: 'SUCCESS, it happens to other people' },
  caption: { text: 'when the image is captioned' },
  caption2: { text: 'a bottom caption bar' },
  whisper: { text: 'psst' },
  snapchat: { text: 'sent from my snapchat' },
  watermark: { text: 'santi.tools' },
  flag: { text: 'pride' },
  hue: { amount: 90 },
  rotate: { amount: 45 },
  jpeg: { amount: 5 },
  wide: { amount: 4 },
  speed: { amount: 2 },
  slow: { amount: 2 },
  freeze: { amount: 3 },
  snapchat_position: { amount: 0.5 },
};

// Effects that only make sense on an animation.
const ANIMATED_ONLY = new Set(['reverse', 'speed', 'slow', 'freeze', 'unfreeze']);

async function main() {
  const argv = process.argv.slice(2);
  let outputDir = null;
  const wanted = [];
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--write') {
      outputDir = argv[index + 1];
      index += 1;
    } else {
      wanted.push(argv[index]);
    }
  }
  if (outputDir) fs.mkdirSync(outputDir, { recursive: true });

  const still = await buildStill();
  const animation = await buildAnimation();

  const effects = listEffects().filter(effect => !wanted.length || wanted.includes(effect.name));
  let failures = 0;

  for (const effect of effects) {
    for (const [label, source] of [['still', still], ['gif', animation]]) {
      if (label === 'still' && ANIMATED_ONLY.has(effect.name)) continue;
      const started = Date.now();
      try {
        // uncaption needs something captioned to strip, so feed it real output
        // from the caption effect.
        const input = effect.name === 'uncaption'
          ? (await applyEffect(source, 'caption', { text: 'a caption to remove' })).buffer
          : source;
        const result = await applyEffect(input, effect.name, PARAMS[effect.name] || {});
        const kib = (result.buffer.length / 1024).toFixed(1);
        console.log(`ok   ${effect.name.padEnd(14)} ${label.padEnd(5)} ${result.format.padEnd(4)} ${String(result.width).padStart(4)}x${String(result.height).padEnd(4)} ${String(result.frames).padStart(3)}f ${kib.padStart(8)} KiB ${Date.now() - started}ms`);
        if (outputDir) {
          fs.writeFileSync(path.join(outputDir, `${effect.name}-${label}.${result.format}`), result.buffer);
        }
      } catch (error) {
        failures += 1;
        console.log(`FAIL ${effect.name.padEnd(14)} ${label.padEnd(5)} ${error.message}`);
      }
    }
  }

  // Option combinations the commands actually pass through, so the params
  // plumbing between /image, /caption, /speechbubble, /watermark and the engine
  // stays covered.
  if (!wanted.length) {
    console.log('');
    for (const [label, effect, params, options] of VARIANTS) {
      const started = Date.now();
      try {
        const result = await applyEffect(still, effect, params, options || {});
        console.log(`ok   ${label.padEnd(28)} ${result.format.padEnd(4)} ${String(result.width).padStart(4)}x${String(result.height).padEnd(4)} ${String(result.frames).padStart(3)}f ${Date.now() - started}ms`);
        if (outputDir) fs.writeFileSync(path.join(outputDir, `variant-${label.replace(/\W+/g, '-')}.${result.format}`), result.buffer);
      } catch (error) {
        failures += 1;
        console.log(`FAIL ${label.padEnd(28)} ${error.message}`);
      }
    }
  }

  console.log(`\n${effects.length} effects checked, ${failures} failure(s).`);
  process.exitCode = failures ? 1 : 0;
}

const VARIANTS = [
  ['caption top bar', 'caption', { text: 'top bar', style: 'caption', position: 'top' }],
  ['caption bottom bar', 'caption', { text: 'bottom bar', style: 'caption', position: 'bottom' }],
  ['caption2 bottom', 'caption2', { text: 'ifunny style', style: 'caption2', position: 'bottom' }],
  ['caption2 top', 'caption2', { text: 'ifunny on top', style: 'caption2', position: 'top' }],
  ['meme case-sensitive', 'meme', { text: 'Keep This Case, lower too', caseSensitive: true }],
  ['meme font times', 'meme', { text: 'serif meme, indeed', font: 'times' }],
  ['motivate title only', 'motivate', { text: 'JUST A TITLE' }],
  ['speechbubble alpha', 'speechbubble', { alpha: true, amount: 0.3 }, { format: 'webp' }],
  ['speechbubble bottom+flip', 'speechbubble', { bottom: true, flip: true }],
  ['watermark top-left', 'watermark', { text: 'santi.tools', position: 'top-left', amount: 1 }],
  ['watermark centre', 'watermark', { text: 'santi.tools', position: 'centre' }],
  ['slide vertical reverse', 'slide', { vertical: true, reverse: true }],
  ['fade alpha', 'fade', { alpha: true }, { format: 'webp' }],
  ['flag trans', 'flag', { text: 'trans' }],
  ['flag nonbinary', 'flag', { text: 'nonbinary' }],
  ['hue negative', 'hue', { amount: -120 }],
  ['snapchat low', 'snapchat', { text: 'near the bottom', amount: 0.9 }],
  ['forced webp output', 'blur', {}, { format: 'webp' }],
  ['forced gif output', 'invert', {}, { format: 'gif' }],
];

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
