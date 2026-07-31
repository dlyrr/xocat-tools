// ============================================================
// /meme — Impact-style top and bottom text
// ============================================================
const { SlashCommandBuilder } = require('discord.js');
const { ALLOWED_FONTS } = require('../../../services/imageEffects');
const { runEffect } = require('../../../services/mediaCommand');
const { addQuietOption, addSourceOptions } = require('./_media.cjs');

const builder = new SlashCommandBuilder()
  .setName('meme')
  .setDescription('Add classic top and bottom meme text to an image or GIF')
  .addStringOption(o => o
    .setName('text')
    .setDescription('Top text, bottom text — separated by a comma (escape a literal comma with \\,)')
    .setRequired(true)
    .setMaxLength(500));

addSourceOptions(builder, { verb: 'caption' });

builder
  .addStringOption(o => o
    .setName('font')
    .setDescription('Font to use (default: impact)')
    .setRequired(false)
    .addChoices(...ALLOWED_FONTS.map(font => ({ name: font, value: font }))))
  .addBooleanOption(o => o
    .setName('case-sensitive')
    .setDescription('Keep the text as typed instead of upper-casing it')
    .setRequired(false));

addQuietOption(builder);

module.exports = {
  data: builder,
  prefixGreedy: 'text',
  prefixAliases: ['memetext'],
  async execute(interaction) {
    return runEffect(interaction, 'meme', { title: 'Meme' });
  },
};
