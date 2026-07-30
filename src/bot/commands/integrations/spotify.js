const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { colors } = require('../../../utils/constants');
const { http, addQuiet, truncate, number, date, apiError, quiet } = require('./_shared.cjs');

let cachedToken = null;
let tokenExpiresAt = 0;

const data = new SlashCommandBuilder()
  .setName('spotify')
  .setDescription('Search Spotify tracks, albums, artists, and playlists');

for (const [name, label] of [
  ['track', 'track'], ['album', 'album'], ['artist', 'artist'], ['playlist', 'playlist'],
]) {
  data.addSubcommand(subcommand => addQuiet(subcommand
    .setName(name)
    .setDescription(`Search Spotify for a ${label}`)
    .addStringOption(option => option.setName('query').setDescription(`${label[0].toUpperCase()}${label.slice(1)} name`).setRequired(true).setMaxLength(200))));
}

async function accessToken() {
  if (!process.env.SPOTIFY_CLIENT_ID || !process.env.SPOTIFY_CLIENT_SECRET) {
    const error = new Error('Spotify search requires `SPOTIFY_CLIENT_ID` and `SPOTIFY_CLIENT_SECRET` in `.env`.');
    error.friendly = true;
    throw error;
  }
  if (cachedToken && Date.now() < tokenExpiresAt) return cachedToken;
  const credentials = Buffer.from(`${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`).toString('base64');
  const { data: token } = await http.post('https://accounts.spotify.com/api/token', 'grant_type=client_credentials', {
    headers: { Authorization: `Basic ${credentials}`, 'Content-Type': 'application/x-www-form-urlencoded' },
  });
  cachedToken = token.access_token;
  tokenExpiresAt = Date.now() + Math.max(30, token.expires_in - 60) * 1000;
  return cachedToken;
}

function duration(milliseconds) {
  const seconds = Math.floor((milliseconds || 0) / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

function artists(items = []) {
  return items.map(item => item.name).filter(Boolean).join(', ') || 'Unknown artist';
}

async function search(type, query) {
  const token = await accessToken();
  const { data: result } = await http.get('https://api.spotify.com/v1/search', {
    params: { q: query, type, limit: 1 },
    headers: { Authorization: `Bearer ${token}` },
  });
  let item = result[`${type}s`]?.items?.[0];
  if (!item) {
    const error = new Error(`No Spotify ${type} matched that search.`);
    error.friendly = true;
    throw error;
  }
  if (type === 'playlist') {
    const { data: full } = await http.get(`https://api.spotify.com/v1/playlists/${item.id}`, {
      params: { fields: 'id,name,description,external_urls,images,owner,public,followers,tracks.total' },
      headers: { Authorization: `Bearer ${token}` },
    });
    item = full;
  }
  return item;
}

function spotifyEmbed(type, item) {
  const link = item.external_urls?.spotify;
  const embed = new EmbedBuilder().setColor(colors.social).setURL(link).setTimestamp();
  if (type === 'track') {
    embed
      .setTitle(item.name)
      .setDescription(`by **${artists(item.artists)}**`)
      .addFields(
        { name: 'Album', value: truncate(item.album?.name || 'Unknown'), inline: true },
        { name: 'Duration', value: duration(item.duration_ms), inline: true },
        { name: 'Popularity', value: `${item.popularity ?? 0}/100`, inline: true },
        { name: 'Released', value: date(item.album?.release_date), inline: true },
        { name: 'Explicit', value: item.explicit ? 'Yes' : 'No', inline: true },
        { name: 'Preview', value: item.preview_url ? `[Listen to preview](${item.preview_url})` : 'Spotify did not provide a preview', inline: true },
      );
  } else if (type === 'album') {
    embed
      .setTitle(item.name)
      .setDescription(`by **${artists(item.artists)}**`)
      .addFields(
        { name: 'Released', value: date(item.release_date), inline: true },
        { name: 'Tracks', value: number(item.total_tracks), inline: true },
        { name: 'Type', value: item.album_type || 'Album', inline: true },
      );
  } else if (type === 'artist') {
    embed
      .setTitle(item.name)
      .addFields(
        { name: 'Followers', value: number(item.followers?.total), inline: true },
        { name: 'Popularity', value: `${item.popularity ?? 0}/100`, inline: true },
        { name: 'Genres', value: truncate(item.genres?.length ? item.genres.join(' • ') : 'Not listed') },
      );
  } else {
    embed
      .setTitle(item.name)
      .setDescription(truncate(item.description || 'No playlist description.', 2000))
      .addFields(
        { name: 'Owner', value: truncate(item.owner?.display_name || 'Unknown'), inline: true },
        { name: 'Tracks', value: number(item.tracks?.total), inline: true },
        { name: 'Followers', value: number(item.followers?.total), inline: true },
      );
  }
  const image = type === 'track' ? item.album?.images?.[0]?.url : item.images?.[0]?.url;
  if (image) embed.setThumbnail(image);
  embed.setFooter({ text: 'Metadata supplied by Spotify' });
  return embed;
}

module.exports = {
  data,
  async execute(interaction) {
    await interaction.deferReply({ flags: quiet(interaction) ? 64 : undefined });
    try {
      const type = interaction.options.getSubcommand();
      const item = await search(type, interaction.options.getString('query', true));
      await interaction.editReply({ embeds: [spotifyEmbed(type, item)] });
    } catch (error) {
      await interaction.editReply({ content: error.friendly ? error.message : apiError(error, 'Spotify could not complete that search.') });
    }
  },
  accessToken,
};
