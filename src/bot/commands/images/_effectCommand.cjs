// ============================================================
// Standalone slash command factory for image effects
// ------------------------------------------------------------
// Discord caps an app at 100 global chat-input commands. The effect registry
// alone has 49 entries, so they cannot all have their own command alongside the
// rest of the bot. The ones listed in PROMOTED (see effects.js) get a real
// command — /deepfry, /magik, /wide — and the rest stay reachable through
// /image and as prefix commands.
//
// Promoting or demoting an effect is a one-line edit to that list; everything
// here derives from the effect's own registry entry.
// ============================================================
const { SlashCommandBuilder } = require('discord.js');
const { ALLOWED_FONTS, getEffect } = require('../../../services/imageEffects');
const { runEffect } = require('../../../services/mediaCommand');
const { addQuietOption, addSourceOptions } = require('./_media.cjs');

// Booleans a few effects read. Kept here rather than in the registry so that
// promoting one of them later picks its flags up automatically.
const EXTRA_BOOLEANS = {
  fade: [['alpha', 'Fade in from transparency instead of from black']],
  slide: [
    ['vertical', 'Slide vertically instead of horizontally'],
    ['reverse', 'Slide in the opposite direction'],
  ],
  speechbubble: [
    ['alpha', 'Cut the bubble out of the image instead of filling it white'],
    ['bottom', 'Put the bubble at the bottom'],
    ['flip', 'Flip the bubble tail to the other side'],
  ],
  meme: [['case-sensitive', 'Keep the text as typed instead of upper-casing it']],
};

// Effects whose output only carries an alpha channel in a format that supports
// one, so the reply is not silently flattened.
const TRANSPARENT_WHEN = {
  fade: interaction => interaction.options.getBoolean('alpha') === true,
  speechbubble: interaction => interaction.options.getBoolean('alpha') === true,
};

function describeAmount(effect) {
  const amount = effect.params.amount;
  const range = Number.isFinite(amount.min) && Number.isFinite(amount.max)
    ? ` (${amount.min}-${amount.max}${amount.default != null ? `, default ${amount.default}` : ''})`
    : '';
  return `${amount.description || 'Effect strength'}${range}`.slice(0, 100);
}

/**
 * Build a full command module for one effect.
 *
 * @param {string} name effect name from the registry
 * @returns {object} a command module the loader can register
 */
function buildEffectCommand(name) {
  const effect = getEffect(name);
  if (!effect) throw new Error(`Cannot build a command for unknown effect "${name}".`);

  const builder = new SlashCommandBuilder()
    .setName(effect.name)
    .setDescription(effect.description.slice(0, 100));

  // The effect's own parameters are declared before the image-source options so
  // that a prefix invocation puts a bare argument where it belongs: `.hue 90`
  // has to land 90 in `amount`, not in `link`.
  const textParam = effect.params?.text;
  if (textParam) {
    builder.addStringOption(o => o
      .setName('text')
      .setDescription((textParam.description || 'Text for the effect').slice(0, 100))
      .setRequired(!!textParam.required)
      .setMaxLength(500));
  }

  if (effect.params?.amount) {
    const amount = effect.params.amount;
    builder.addNumberOption(o => {
      o.setName('amount').setDescription(describeAmount(effect)).setRequired(false);
      if (Number.isFinite(amount.min)) o.setMinValue(amount.min);
      if (Number.isFinite(amount.max)) o.setMaxValue(amount.max);
      return o;
    });
  }

  if (effect.params?.font) {
    builder.addStringOption(o => o
      .setName('font')
      .setDescription(`Font to use (default: ${effect.params.font.default || 'impact'})`)
      .setRequired(false)
      .addChoices(...ALLOWED_FONTS.map(font => ({ name: font, value: font }))));
  }

  addSourceOptions(builder, { verb: effect.name });

  for (const [option, description] of EXTRA_BOOLEANS[effect.name] || []) {
    builder.addBooleanOption(o => o.setName(option).setDescription(description).setRequired(false));
  }

  addQuietOption(builder);

  const needsTransparency = TRANSPARENT_WHEN[effect.name];

  return {
    data: builder,
    // Every alias the effect declares becomes a prefix alias for this command,
    // so `.fry` reaches /deepfry rather than falling through to /image.
    prefixAliases: effect.aliases || [],
    prefixGreedy: textParam ? 'text' : undefined,
    async execute(interaction) {
      return runEffect(interaction, effect.name, {
        format: needsTransparency?.(interaction) ? 'webp' : undefined,
      });
    },
  };
}

module.exports = { EXTRA_BOOLEANS, buildEffectCommand };
