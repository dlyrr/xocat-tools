// ============================================================
// /motivate — motivational poster generator
// ============================================================
const { SlashCommandBuilder } = require('discord.js');
const { ALLOWED_FONTS } = require('../../../services/imageEffects');
const { runEffect } = require('../../../services/mediaCommand');
const { addQuietOption, addSourceOptions } = require('./_media.cjs');

const builder = new SlashCommandBuilder()
  .setName('motivate')
  .setDescription('Turn an image into a motivational (or demotivational) poster')
  .addStringOption(o => o
    .setName('text')
    .setDescription('Title, subtitle — separated by a comma')
    .setRequired(true)
    .setMaxLength(500));

addSourceOptions(builder, { verb: 'frame' });

builder.addStringOption(o => o
  .setName('font')
  .setDescription('Font to use (default: times)')
  .setRequired(false)
  .addChoices(...ALLOWED_FONTS.map(font => ({ name: font, value: font }))));

addQuietOption(builder);

module.exports = {
  data: builder,
  prefixGreedy: 'text',
  async execute(interaction) {
    return runEffect(interaction, 'motivate', { title: 'Motivational poster' });
  },
};
