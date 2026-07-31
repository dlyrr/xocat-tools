// ============================================================
// /mirror — the haah/waaw/woow/hooh family in one command
// ------------------------------------------------------------
// Four effects that differ only by which half gets mirrored, grouped so they
// cost one slash command slot instead of four. The esmBot names still work as
// prefix commands (.haah, .waaw, .woow, .hooh) via the prepend aliases below.
// ============================================================
const { SlashCommandBuilder } = require('discord.js');
const { runEffect } = require('../../../services/mediaCommand');
const { addQuietOption, addSourceOptions } = require('./_media.cjs');

const DIRECTIONS = [
  { name: 'haah — mirror the left half onto the right', value: 'haah' },
  { name: 'waaw — mirror the right half onto the left', value: 'waaw' },
  { name: 'woow — mirror the top onto the bottom', value: 'woow' },
  { name: 'hooh — mirror the bottom onto the top', value: 'hooh' },
];

const builder = new SlashCommandBuilder()
  .setName('mirror')
  .setDescription('Mirror one half of an image onto the other')
  .addStringOption(o => o
    .setName('direction')
    .setDescription('Which half to keep and mirror (default: waaw)')
    .setRequired(false)
    .addChoices(...DIRECTIONS));

addSourceOptions(builder, { verb: 'mirror' });
addQuietOption(builder);

module.exports = {
  data: builder,

  // Each esmBot name pre-fills the direction, so `.haah` behaves exactly as it
  // does there. Bare `.mirror` is waaw, matching esmBot's alias for it.
  prefixAliases: [
    { alias: 'haah', prepend: ['haah'] },
    { alias: 'mirror2', prepend: ['haah'] },
    { alias: 'magik4', prepend: ['haah'] },
    { alias: 'waaw', prepend: ['waaw'] },
    { alias: 'magik3', prepend: ['waaw'] },
    { alias: 'woow', prepend: ['woow'] },
    { alias: 'mirror3', prepend: ['woow'] },
    { alias: 'magik5', prepend: ['woow'] },
    { alias: 'hooh', prepend: ['hooh'] },
    { alias: 'mirror4', prepend: ['hooh'] },
    { alias: 'magik6', prepend: ['hooh'] },
  ],

  async execute(interaction) {
    const direction = interaction.options.getString('direction') || 'waaw';
    return runEffect(interaction, direction, { title: `Mirror (${direction})` });
  },
};
