// /lyrics — Get song lyrics
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { colors } = require('../../../utils/constants');
const axios = require('axios');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('lyrics')
    .setDescription('Get song lyrics using an artist and title')
    .addStringOption(o => o.setName('song').setDescription('Artist - Song').setRequired(true).setMaxLength(240)).addBooleanOption(
    o => o.setName("quiet").setDescription("Make the response only visible to you").setRequired(false)
  ),
  async execute(interaction) {
    const quiet = interaction.options.getBoolean("quiet") ?? false;
    await interaction.deferReply({
      flags: quiet ? 64 : undefined
    });
    try {
      const song = interaction.options.getString('song');
      const separator = song.indexOf(' - ');
      if (separator <= 0 || separator >= song.length - 3) {
        return interaction.editReply({ content: '❌ Use the format `Artist - Song`.' });
      }

      const artist = song.slice(0, separator).trim();
      const title = song.slice(separator + 3).trim();
      const { data } = await axios.get(`https://api.lyrics.ovh/v1/${encodeURIComponent(artist)}/${encodeURIComponent(title)}`, { timeout: 10000 });
      const lyrics = data.lyrics?.trim();
      if (!lyrics) return interaction.editReply({ content: '❌ No lyrics were found for that artist and song.' });
      const descriptionLimit = 3900;
      const embed = new EmbedBuilder().setColor(colors.social).setTitle(song.slice(0, 250))
        .setDescription(lyrics.slice(0, descriptionLimit))
        .setFooter({ text: lyrics.length > descriptionLimit ? 'Lyrics.ovh • truncated to fit Discord' : 'Lyrics.ovh • live lyrics' })
        .setTimestamp();
      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      const message = error.response?.status === 404
        ? 'No lyrics were found for that artist and song.'
        : 'The lyrics service is currently unavailable.';
      await interaction.editReply({ content: `❌ ${message}` });
    }
  },
};

