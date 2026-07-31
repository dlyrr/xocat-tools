const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { colors } = require('../../../utils/constants');

module.exports = {
  prefixAliases: ['pong', 'latency'],
  data: new SlashCommandBuilder()
    .setName('ping')
    .setDescription('Check the bot\'s latency')
    .addBooleanOption(o => o.setName('quiet').setDescription('Make the response only visible to you').setRequired(false)),
  async execute(interaction) {
    const quiet = interaction.options.getBoolean('quiet') ?? false;
    const sent = await interaction.reply({ content: 'Pinging...', fetchReply: true, flags: quiet ? 64 : undefined });
    const latency = sent.createdTimestamp - interaction.createdTimestamp;
    const apiLatency = Math.round(interaction.client.ws.ping);

    const embed = new EmbedBuilder()
      .setColor(colors.utility)
      .setTitle('Pong')
      .addFields(
        { name: 'Bot Latency', value: `\`${latency}ms\``, inline: true },
        { name: 'API Latency', value: `\`${apiLatency}ms\``, inline: true }
      )
      .setTimestamp();

    await interaction.editReply({ content: '', embeds: [embed] });
  },
};
