const { SlashCommandBuilder } = require('discord.js');
const { getMedia, mediaEmbed } = require('./anilist.cjs');
const { apiError, quiet } = require('./_shared.cjs');

module.exports = {
  prefixGreedy: 'query',
  prefixAliases: ['mal', 'anilist'],
  data: new SlashCommandBuilder()
    .setName('anime')
    .setDescription('Search anime and show detailed information')
    .addStringOption(option => option.setName('query').setDescription('Anime title').setRequired(true).setMaxLength(200))
    .addBooleanOption(option => option.setName('quiet').setDescription('Make the response only visible to you').setRequired(false)),
  async execute(interaction) {
    await interaction.deferReply({ flags: quiet(interaction) ? 64 : undefined });
    try {
      const media = await getMedia(interaction.options.getString('query', true), 'ANIME');
      await interaction.editReply({ embeds: [mediaEmbed(media, 'ANIME')] });
    } catch (error) {
      await interaction.editReply({ content: error.friendly ? error.message : apiError(error, 'AniList could not complete that anime search.') });
    }
  },
};
