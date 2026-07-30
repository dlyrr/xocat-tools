const { SlashCommandBuilder } = require('discord.js');
const { shortenUrl } = require('../../../services/ezhostService');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('shorten')
    .setDescription('Shorten a URL using e-z.host')
    .addStringOption(o => o.setName('url').setDescription('The long URL to shorten').setRequired(true).setMaxLength(2000))
    .addBooleanOption(o => o.setName('quiet').setDescription('Make the response only visible to you').setRequired(false)),

  async execute(interaction) {
    const quiet = interaction.options.getBoolean('quiet') ?? false;
    const url = interaction.options.getString('url');
    
    await interaction.deferReply({ flags: quiet ? 64 : undefined });

    try {
      const result = await shortenUrl(url);
      await interaction.editReply({ content: result.shortUrl });
    } catch (err) {
      console.error('[SHORTEN] Error:', err.message);
      await interaction.editReply({ content: `❌ Error: ${err.message}` });
    }
  },
};
