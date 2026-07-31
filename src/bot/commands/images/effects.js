// ============================================================
// Promoted image effects — one slash command each
// ------------------------------------------------------------
// This module exports an ARRAY of commands rather than a single one; the loader,
// the deploy script, and /help all accept either.
//
// Why a subset: Discord caps an application at 100 global chat-input commands.
// The effect registry has 49 entries and the rest of the bot uses 77 slots, so
// promoting all of them is impossible — see the budget note below. The effects
// listed here get a real command (/deepfry, /magik, /wide …); the rest stay
// reachable through /image and as prefix commands, which cost nothing.
//
// To promote or demote an effect, move its name in or out of PROMOTED and
// redeploy. deploy-commands.js refuses to deploy if the total would exceed
// Discord's cap, so an over-long list fails loudly instead of silently
// truncating.
//
// Budget as it stands:
//   77  other commands
//   19  promoted effects (below)
//    2  grouped effect commands (/mirror covers 4, /gifspeed covers 5)
//   ---
//   98  of 100, leaving two spare slots
//
// Effects deliberately left on /image only, because they are either niche or
// already reachable another way:
//   sharpen sepia vignette flag rotate crop tile wall circle fade slide gif
//   (gif ~ /togif; caption2, whisper and snapchat are styles of /caption)
// ============================================================
const { buildEffectCommand } = require('./_effectCommand.cjs');

const PROMOTED = [
  // Colour
  'deepfry',
  'jpeg',
  'blur',
  'pixelate',
  'invert',
  'grayscale',
  'hue',
  // Geometry
  'flip',
  'flop',
  'wide',
  'stretch',
  'squish',
  // Distortion
  'magik',
  'spin',
  'globe',
  'explode',
  'implode',
  'swirl',
  // Animation
  'bounce',
];

module.exports = PROMOTED.map(buildEffectCommand);
module.exports.PROMOTED = PROMOTED;
