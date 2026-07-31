// ============================================================
// /gifspeed — animation timing effects in one command
// ------------------------------------------------------------
// speed, slow, reverse, freeze and unfreeze all just rewrite frame timing, so
// they are grouped into one slash command slot. The individual esmBot names
// still work as prefix commands (.speed 2, .reverse, .noloop) via the prepend
// aliases below.
// ============================================================
const { SlashCommandBuilder } = require('discord.js');
const { runEffect } = require('../../../services/mediaCommand');
const { addQuietOption, addSourceOptions } = require('./_media.cjs');

const MODES = [
  { name: 'speed — play faster', value: 'speed' },
  { name: 'slow — play slower', value: 'slow' },
  { name: 'reverse — play backwards', value: 'reverse' },
  { name: 'freeze — play once instead of looping', value: 'freeze' },
  { name: 'unfreeze — start looping again', value: 'unfreeze' },
];

const builder = new SlashCommandBuilder()
  .setName('gifspeed')
  .setDescription('Speed up, slow down, reverse, freeze, or unfreeze an animation')
  .addStringOption(o => o
    .setName('mode')
    .setDescription('What to do to the animation')
    .setRequired(true)
    .addChoices(...MODES))
  .addNumberOption(o => o
    .setName('amount')
    .setDescription('Multiplier for speed/slow (default 2), or the frame to stop on for freeze')
    .setRequired(false)
    .setMinValue(1)
    .setMaxValue(300));

addSourceOptions(builder, { verb: 'retime' });
addQuietOption(builder);

module.exports = {
  data: builder,

  prefixAliases: [
    { alias: 'speed', prepend: ['speed'] },
    { alias: 'speedup', prepend: ['speed'] },
    { alias: 'fast', prepend: ['speed'] },
    { alias: 'faster', prepend: ['speed'] },
    { alias: 'slow', prepend: ['slow'] },
    { alias: 'slowdown', prepend: ['slow'] },
    { alias: 'slower', prepend: ['slow'] },
    { alias: 'reverse', prepend: ['reverse'] },
    { alias: 'backwards', prepend: ['reverse'] },
    { alias: 'freeze', prepend: ['freeze'] },
    { alias: 'noloop', prepend: ['freeze'] },
    { alias: 'once', prepend: ['freeze'] },
    { alias: 'unfreeze', prepend: ['unfreeze'] },
  ],

  async execute(interaction) {
    const mode = interaction.options.getString('mode');
    return runEffect(interaction, mode, { title: `Animation (${mode})` });
  },
};
