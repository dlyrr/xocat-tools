// ============================================================
// /speechbubble — adds a speech bubble to an image
// ============================================================
const { SlashCommandBuilder } = require('discord.js');
const { runEffect } = require('../../../services/mediaCommand');
const { addQuietOption, addSourceOptions } = require('./_media.cjs');

const builder = new SlashCommandBuilder()
  .setName('speechbubble')
  .setDescription('Add a speech bubble to an image or GIF');

addSourceOptions(builder, { verb: 'add a speech bubble to' });

builder
  .addNumberOption(o => o
    .setName('amount')
    .setDescription('Bubble height as a fraction of the image (0.01 smallest, 1.0 largest, default 0.2)')
    .setRequired(false)
    .setMinValue(0.05)
    .setMaxValue(1))
  .addBooleanOption(o => o
    .setName('alpha')
    .setDescription('Cut the bubble out of the image instead of filling it white')
    .setRequired(false))
  .addBooleanOption(o => o
    .setName('bottom')
    .setDescription('Put the bubble at the bottom of the image')
    .setRequired(false))
  .addBooleanOption(o => o
    .setName('flip')
    .setDescription('Flip the bubble tail to the other side')
    .setRequired(false));

addQuietOption(builder);

module.exports = {
  data: builder,
  prefixAliases: ['speech', 'bubble'],
  async execute(interaction) {
    // Transparency needs a format that carries an alpha channel.
    const alpha = interaction.options.getBoolean('alpha') ?? false;
    return runEffect(interaction, 'speechbubble', {
      title: 'Speech bubble',
      format: alpha ? 'webp' : undefined,
    });
  },
};
