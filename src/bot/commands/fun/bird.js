// ============================================================
// /bird — random bird pictures
// ============================================================
const axios = require('axios');
const { EmbedBuilder, SlashCommandBuilder } = require('discord.js');
const { colors } = require('../../../utils/constants');

// shibe.online serves keyless random animal images and also covers shibes and
// cats, which makes it a reliable stand-in for esmBot's own bird endpoint.
const ENDPOINT = 'https://shibe.online/api/birds?count=1&urls=true&httpsUrls=true';

module.exports = {
  data: new SlashCommandBuilder()
    .setName('bird')
    .setDescription('Get a random bird picture')
    .addBooleanOption(o => o.setName('quiet').setDescription('Make the response only visible to you').setRequired(false)),

  prefixAliases: ['birb', 'birds', 'birbs'],

  async execute(interaction) {
    const quiet = interaction.options.getBoolean('quiet') ?? false;
    await interaction.deferReply({ flags: quiet ? 64 : undefined });

    try {
      const { data } = await axios.get(ENDPOINT, { timeout: 15000 });
      const imageUrl = Array.isArray(data) ? data[0] : null;
      if (typeof imageUrl !== 'string') throw new Error('the API did not return an image.');

      const embed = new EmbedBuilder()
        .setColor(colors.fun)
        .setTitle('Random bird')
        .setImage(imageUrl)
        .setFooter({ text: 'shibe.online' })
        .setTimestamp();

      return interaction.editReply({ embeds: [embed] });
    } catch (error) {
      return interaction.editReply(`❌ Could not fetch a bird: ${error.message}`);
    }
  },
};
