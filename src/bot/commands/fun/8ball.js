// /8ball — Magic 8-Ball
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { colors, emojis, eightBallResponses } = require('../../../utils/constants');

module.exports = {
  prefixGreedy: 'question',
  prefixAliases: ['8b', 'magic8ball', 'eightball'],
  data: new SlashCommandBuilder()
    .setName('8ball')
    .setDescription('Ask the magic 8ball a question')
    .addStringOption(o => o.setName('question').setDescription('Your question').setRequired(true).setMaxLength(1000)).addBooleanOption(
    o => o.setName("quiet").setDescription("Make the response only visible to you").setRequired(false)
  ),
  async execute(interaction) {
    const quiet = interaction.options.getBoolean("quiet") ?? false;
    const question = interaction.options.getString('question');
    const answer = eightBallResponses[Math.floor(Math.random() * eightBallResponses.length)];
    const embed = new EmbedBuilder()
      .setColor(colors.fun)
      .setTitle(`${emojis.dice} Magic 8-Ball`)
      .addFields(
        { name: 'Question', value: question },
        { name: 'Answer', value: `**${answer}**` },
      )
      .setFooter({ text: `Asked by ${interaction.user.tag}`, iconURL: interaction.user.displayAvatarURL() })
      .setTimestamp();
    await interaction.reply({
      embeds: [embed],
      flags: quiet ? 64 : undefined
    });
  },
};

