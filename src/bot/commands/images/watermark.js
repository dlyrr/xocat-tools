// ============================================================
// /watermark — stamps text over an image
// ------------------------------------------------------------
// esmBot ships a set of branded watermark PNGs (iFunny, 9GAG, HyperCam and so
// on). Those are third-party artwork, so this takes arbitrary text instead,
// which covers the same use case without vendoring images.
// ============================================================
const { SlashCommandBuilder } = require('discord.js');
const { runEffect } = require('../../../services/mediaCommand');
const { addQuietOption, addSourceOptions } = require('./_media.cjs');

const POSITIONS = [
  'top-left', 'top', 'top-right',
  'left', 'centre', 'right',
  'bottom-left', 'bottom', 'bottom-right',
];

const builder = new SlashCommandBuilder()
  .setName('watermark')
  .setDescription('Stamp a text watermark onto an image or GIF')
  .addStringOption(o => o
    .setName('text')
    .setDescription('The watermark text')
    .setRequired(true)
    .setMaxLength(120));

addSourceOptions(builder, { verb: 'watermark' });

builder
  .addStringOption(o => o
    .setName('position')
    .setDescription('Where to place the watermark (default: bottom-right)')
    .setRequired(false)
    .addChoices(...POSITIONS.map(position => ({ name: position, value: position }))))
  .addNumberOption(o => o
    .setName('amount')
    .setDescription('Opacity from 0.05 to 1.0 (default 0.6)')
    .setRequired(false)
    .setMinValue(0.05)
    .setMaxValue(1));

addQuietOption(builder);

module.exports = {
  data: builder,
  prefixGreedy: 'text',
  prefixAliases: ['wm'],
  async execute(interaction) {
    return runEffect(interaction, 'watermark', { title: 'Watermark' });
  },
};
