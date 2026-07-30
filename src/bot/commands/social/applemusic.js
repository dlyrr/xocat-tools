// /applemusic — Apple Music commands
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { colors } = require('../../../utils/constants');
const applemusic = require('../../../services/applemusicService');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('applemusic')
    .setDescription('Apple Music commands')
    .addSubcommand(s => s.setName('search').setDescription('Search for an Apple Music track').addStringOption(o => o.setName('query').setDescription('Song name').setRequired(true).setMaxLength(100)).addBooleanOption(
    o => o.setName("quiet").setDescription("Make the response only visible to you").setRequired(false)
  ))
    .addSubcommand(s => s.setName('artists').setDescription('Search for an Apple Music artist').addStringOption(o => o.setName('query').setDescription('Artist name').setRequired(true).setMaxLength(100)).addBooleanOption(
    o => o.setName("quiet").setDescription("Make the response only visible to you").setRequired(false)
  ))
    .addSubcommand(s => s.setName('preview').setDescription('Preview an Apple Music track').addStringOption(o => o.setName('query').setDescription('Song name').setRequired(true).setMaxLength(100)).addBooleanOption(
    o => o.setName("quiet").setDescription("Make the response only visible to you").setRequired(false)
  )),
  async execute(interaction) {
    const quiet = interaction.options.getBoolean("quiet") ?? false;
    await interaction.deferReply({
      flags: quiet ? 64 : undefined
    });
    const sub = interaction.options.getSubcommand();
    try {
      if (sub === 'search') {
        const query = interaction.options.getString('query');
        const results = await applemusic.searchTrack(query, 5);
        const tracks = results.results || [];
        if (!tracks.length) return interaction.editReply({ content: '❌ No tracks found.' });
        const desc = clip(tracks.map((t, i) => `**${i + 1}.** [${t.trackName}](${t.trackViewUrl}) by ${t.artistName}\n  ${Math.floor(t.trackTimeMillis / 60000)}:${String(Math.floor((t.trackTimeMillis % 60000) / 1000)).padStart(2, '0')} · ${t.collectionName}`).join('\n\n'), 3900);
        const embed = new EmbedBuilder().setColor(colors.applemusic).setTitle('Apple Music search').setDescription(desc)
          .setThumbnail(tracks[0].artworkUrl100?.replace('100x100bb', '600x600bb'))
          .setFooter({ text: 'Apple Music • search results' }).setTimestamp();
        await interaction.editReply({ embeds: [embed] });
      } else if (sub === 'artists') {
        const query = interaction.options.getString('query');
        const results = await applemusic.searchArtist(query, 5);
        const artists = results.results || [];
        if (!artists.length) return interaction.editReply({ content: '❌ No artists found.' });
        const desc = clip(artists.map((a, i) => `**${i + 1}.** [${a.artistName}](${a.artistLinkUrl})\n  Genre: ${a.primaryGenreName || 'N/A'}`).join('\n\n'), 3900);
        const embed = new EmbedBuilder().setColor(colors.applemusic).setTitle('Apple Music artists').setDescription(desc)
          .setFooter({ text: 'Apple Music • artist results' }).setTimestamp();
        await interaction.editReply({ embeds: [embed] });
      } else if (sub === 'preview') {
        const query = interaction.options.getString('query');
        const results = await applemusic.searchTrack(query, 1);
        const track = results.results?.[0];
        if (!track) return interaction.editReply({ content: '❌ Track not found.' });
        const embed = new EmbedBuilder().setColor(colors.applemusic)
          .setTitle(clip(track.trackName || 'Track', 250))
          .setDescription(clip(`By **${track.artistName}**\nAlbum: ${track.collectionName}`, 3900))
          .setThumbnail(track.artworkUrl100?.replace('100x100bb', '600x600bb'))
          .addFields({ name: 'Listen', value: `[Open in Apple Music](${track.trackViewUrl})` })
          .setFooter({ text: 'Apple Music • track preview' })
          .setTimestamp();
        if (track.previewUrl) {
          embed.addFields({ name: 'Preview', value: `[30s audio preview](${track.previewUrl})` });
        }
        await interaction.editReply({ embeds: [embed] });
      }
    } catch (err) {
      await interaction.editReply({ content: `❌ Error: ${err.message}` });
    }
  },
};

function clip(value, maxLength) {
  const text = String(value ?? '');
  return text.length <= maxLength ? text : `${text.slice(0, maxLength - 3)}...`;
}
