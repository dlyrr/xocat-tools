// ============================================================
// /image — the esmBot-style image effect engine
// ------------------------------------------------------------
// One slash command fronting the whole effect registry, because Discord caps a
// bot at 100 global commands and the registry alone has ~50 entries. Every
// effect also gets its own prefix command (`.deepfry`, `.magik`, `.meme` …)
// through the alias list exported at the bottom of this file, which is how
// esmBot exposes them.
// ============================================================
const { EmbedBuilder, SlashCommandBuilder } = require('discord.js');
const { colors } = require('../../../utils/constants');
const { ALLOWED_FONTS, listEffects, resolveEffectName } = require('../../../services/imageEffects');
const { runEffect } = require('../../../services/mediaCommand');

const POSITIONS = [
  'top-left', 'top', 'top-right',
  'left', 'centre', 'right',
  'bottom-left', 'bottom', 'bottom-right',
];

const CATEGORY_LABELS = {
  colour: 'Colour & filters',
  geometry: 'Geometry',
  distortion: 'Distortion',
  text: 'Text',
  animation: 'Animation',
};

function effectChoiceLabel(effect) {
  return `${effect.name} — ${effect.description}`.slice(0, 100);
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('image')
    .setDescription('Apply an image or GIF effect (deepfry, magik, meme, spin, and ~45 more)')
    .addStringOption(o => o
      .setName('effect')
      .setDescription('The effect to apply — start typing to search')
      .setRequired(true)
      .setAutocomplete(true))
    .addStringOption(o => o
      .setName('text')
      .setDescription('Text for effects that need it (meme/motivate: separate top and bottom with a comma)')
      .setRequired(false)
      .setMaxLength(500))
    .addAttachmentOption(o => o
      .setName('file')
      .setDescription('The image or GIF to edit (defaults to the most recent one in the channel)')
      .setRequired(false))
    .addStringOption(o => o
      .setName('link')
      .setDescription('An image URL, custom emoji, or user ID to use instead of an attachment')
      .setRequired(false)
      .setMaxLength(500))
    .addUserOption(o => o
      .setName('user')
      .setDescription("Use this user's avatar as the image")
      .setRequired(false))
    .addNumberOption(o => o
      .setName('amount')
      .setDescription('Effect strength — see /image effect:<name> descriptions for what it controls')
      .setRequired(false))
    .addStringOption(o => o
      .setName('font')
      .setDescription('Font for text effects')
      .setRequired(false)
      .addChoices(...ALLOWED_FONTS.map(font => ({ name: font, value: font }))))
    .addStringOption(o => o
      .setName('position')
      .setDescription('Placement for effects that support it (caption, watermark)')
      .setRequired(false)
      .addChoices(...POSITIONS.map(position => ({ name: position, value: position }))))
    .addStringOption(o => o
      .setName('format')
      .setDescription('Force the output format')
      .setRequired(false)
      .addChoices(
        { name: 'GIF', value: 'gif' },
        { name: 'PNG', value: 'png' },
        { name: 'WebP', value: 'webp' },
      ))
    .addBooleanOption(o => o.setName('alpha').setDescription('Use transparency (fade, speechbubble)').setRequired(false))
    .addBooleanOption(o => o.setName('vertical').setDescription('Work vertically instead of horizontally (slide)').setRequired(false))
    .addBooleanOption(o => o.setName('reverse').setDescription('Reverse the direction (slide)').setRequired(false))
    .addBooleanOption(o => o.setName('bottom').setDescription('Anchor to the bottom (speechbubble)').setRequired(false))
    .addBooleanOption(o => o.setName('flip').setDescription('Flip the overlay (speechbubble)').setRequired(false))
    .addBooleanOption(o => o.setName('case-sensitive').setDescription('Keep meme text lowercase instead of upper-casing it').setRequired(false))
    .addBooleanOption(o => o.setName('quiet').setDescription('Make the response only visible to you').setRequired(false)),

  // Lets prefix invocations write `.image meme top text, bottom text` without
  // needing quotes around the caption.
  prefixGreedy: 'text',

  async autocomplete(interaction) {
    const query = interaction.options.getFocused().toLowerCase().trim();
    const effects = listEffects();

    const matches = query
      ? effects.filter(effect => effect.name.includes(query)
        || (effect.aliases || []).some(alias => alias.includes(query))
        || effect.description.toLowerCase().includes(query))
      : effects;

    await interaction.respond(matches.slice(0, 25).map(effect => ({
      name: effectChoiceLabel(effect),
      value: effect.name,
    })));
  },

  async execute(interaction) {
    const requested = interaction.options.getString('effect');

    // `list` is not an effect, but it is the first thing people try.
    if (/^(list|help|effects)$/i.test(requested.trim())) {
      const quiet = interaction.options.getBoolean('quiet') ?? false;
      return interaction.reply({ embeds: [buildEffectList()], flags: quiet ? 64 : undefined });
    }

    const effect = resolveEffectName(requested);
    if (!effect) {
      const quiet = interaction.options.getBoolean('quiet') ?? false;
      return interaction.reply({
        content: `❌ \`${requested.slice(0, 40)}\` is not an effect. Run \`/image effect:list\` to see them all.`,
        flags: quiet ? 64 : undefined,
      });
    }

    return runEffect(interaction, effect);
  },
};

function buildEffectList() {
  const grouped = new Map();
  for (const effect of listEffects()) {
    if (!grouped.has(effect.category)) grouped.set(effect.category, []);
    grouped.get(effect.category).push(effect.name);
  }

  const embed = new EmbedBuilder()
    .setColor(colors.utility)
    .setTitle('Image effects')
    .setDescription('Use `/image effect:<name>`, or run any effect as a prefix command — `.deepfry`, `.magik`, `.meme top, bottom`.')
    .setTimestamp();

  for (const [category, names] of grouped) {
    embed.addFields({
      name: `${CATEGORY_LABELS[category] || category} (${names.length})`,
      value: names.map(name => `\`${name}\``).join(' '),
    });
  }

  return embed;
}
