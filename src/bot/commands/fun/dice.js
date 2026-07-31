// ============================================================
// /dice — roll dice
// ============================================================
const crypto = require('crypto');
const { EmbedBuilder, SlashCommandBuilder } = require('discord.js');
const { colors, emojis } = require('../../../utils/constants');

const MAX_DICE = 25;
const MAX_SIDES = 1000000;

function roll(sides) {
  // crypto.randomInt is unbiased, unlike Math.random() * n | 0.
  return crypto.randomInt(1, sides + 1);
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('dice')
    .setDescription('Roll one or more dice')
    .addIntegerOption(o => o
      .setName('sides')
      .setDescription('How many sides each die has (default: 6)')
      .setRequired(false)
      .setMinValue(2)
      .setMaxValue(MAX_SIDES))
    .addIntegerOption(o => o
      .setName('count')
      .setDescription('How many dice to roll (default: 1)')
      .setRequired(false)
      .setMinValue(1)
      .setMaxValue(MAX_DICE))
    .addBooleanOption(o => o.setName('quiet').setDescription('Make the response only visible to you').setRequired(false)),

  prefixAliases: ['roll', 'die', 'rng', 'd'],

  async execute(interaction) {
    const quiet = interaction.options.getBoolean('quiet') ?? false;
    const sides = interaction.options.getInteger('sides') ?? 6;
    const count = interaction.options.getInteger('count') ?? 1;

    const results = Array.from({ length: count }, () => roll(sides));
    const total = results.reduce((sum, value) => sum + value, 0);

    if (count === 1) {
      return interaction.reply({
        content: `${emojis.dice} You rolled a **${total}** on a ${sides}-sided die.`,
        flags: quiet ? 64 : undefined,
      });
    }

    const embed = new EmbedBuilder()
      .setColor(colors.fun)
      .setTitle(`${emojis.dice} ${count}d${sides}`)
      .setDescription(results.map(value => `\`${value}\``).join(' '))
      .addFields(
        { name: 'Total', value: String(total), inline: true },
        { name: 'Highest', value: String(Math.max(...results)), inline: true },
        { name: 'Lowest', value: String(Math.min(...results)), inline: true },
      )
      .setTimestamp();

    return interaction.reply({ embeds: [embed], flags: quiet ? 64 : undefined });
  },
};
