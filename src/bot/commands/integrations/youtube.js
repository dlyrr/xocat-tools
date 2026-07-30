const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { colors } = require('../../../utils/constants');
const { http, addQuiet, truncate, number, dateTime, apiError, quiet } = require('./_shared.cjs');

const data = new SlashCommandBuilder()
  .setName('youtube')
  .setDescription('Search YouTube videos and channels')
  .addSubcommand(subcommand => addQuiet(subcommand
    .setName('video')
    .setDescription('Search for a video and show its public statistics')
    .addStringOption(option => option.setName('query').setDescription('Video title or keywords').setRequired(true).setMaxLength(200))))
  .addSubcommand(subcommand => addQuiet(subcommand
    .setName('channel')
    .setDescription('Search for a channel and show its public statistics')
    .addStringOption(option => option.setName('query').setDescription('Channel name or keywords').setRequired(true).setMaxLength(200))));

function apiKey() {
  if (!process.env.YOUTUBE_API_KEY) {
    const error = new Error('YouTube search requires `YOUTUBE_API_KEY` in `.env` with YouTube Data API v3 enabled.');
    error.friendly = true;
    throw error;
  }
  return process.env.YOUTUBE_API_KEY;
}

function duration(value) {
  const match = String(value || '').match(/^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!match) return 'Unknown';
  const [, days, hours, minutes, seconds] = match.map(item => Number(item || 0));
  const totalHours = days * 24 + hours;
  return [totalHours || null, String(minutes).padStart(totalHours ? 2 : 1, '0'), String(seconds).padStart(2, '0')].filter(item => item !== null).join(':');
}

async function youtubeSearch(type, query) {
  const key = apiKey();
  const kind = type === 'video' ? 'video' : 'channel';
  const { data: searchResult } = await http.get('https://www.googleapis.com/youtube/v3/search', {
    params: { key, part: 'snippet', type: kind, q: query, maxResults: 1, safeSearch: 'moderate' },
  });
  const hit = searchResult.items?.[0];
  if (!hit) {
    const error = new Error(`No YouTube ${type} matched that search.`);
    error.friendly = true;
    throw error;
  }
  const id = type === 'video' ? hit.id.videoId : hit.id.channelId;
  const endpoint = type === 'video' ? 'videos' : 'channels';
  const part = type === 'video' ? 'snippet,contentDetails,statistics' : 'snippet,statistics,brandingSettings';
  const { data: detail } = await http.get(`https://www.googleapis.com/youtube/v3/${endpoint}`, {
    params: { key, part, id },
  });
  if (!detail.items?.[0]) {
    const error = new Error(`YouTube found the ${type}, but its details are unavailable.`);
    error.friendly = true;
    throw error;
  }
  return detail.items[0];
}

function videoEmbed(video) {
  const snippet = video.snippet;
  const stats = video.statistics || {};
  const embed = new EmbedBuilder()
    .setColor(colors.social)
    .setTitle(truncate(snippet.title, 256))
    .setURL(`https://www.youtube.com/watch?v=${video.id}`)
    .setDescription(truncate(snippet.description || 'No description.', 1600))
    .addFields(
      { name: 'Channel', value: `[${snippet.channelTitle}](https://www.youtube.com/channel/${snippet.channelId})`, inline: true },
      { name: 'Uploaded', value: dateTime(snippet.publishedAt), inline: true },
      { name: 'Duration', value: duration(video.contentDetails?.duration), inline: true },
      { name: 'Views', value: number(stats.viewCount), inline: true },
      { name: 'Likes', value: stats.likeCount == null ? 'Hidden / unavailable' : number(stats.likeCount), inline: true },
      { name: 'Comments', value: stats.commentCount == null ? 'Disabled / unavailable' : number(stats.commentCount), inline: true },
    )
    .setFooter({ text: 'Metadata supplied by YouTube Data API v3' })
    .setTimestamp();
  const image = snippet.thumbnails?.maxres?.url || snippet.thumbnails?.high?.url;
  if (image) embed.setImage(image);
  return embed;
}

function channelEmbed(channel) {
  const snippet = channel.snippet;
  const stats = channel.statistics || {};
  const banner = channel.brandingSettings?.image?.bannerExternalUrl;
  const embed = new EmbedBuilder()
    .setColor(colors.social)
    .setTitle(truncate(snippet.title, 256))
    .setURL(`https://www.youtube.com/channel/${channel.id}`)
    .setDescription(truncate(snippet.description || 'No channel description.', 1800))
    .addFields(
      { name: 'Subscribers', value: stats.hiddenSubscriberCount ? 'Hidden' : number(stats.subscriberCount), inline: true },
      { name: 'Videos', value: number(stats.videoCount), inline: true },
      { name: 'Total views', value: number(stats.viewCount), inline: true },
      { name: 'Created', value: dateTime(snippet.publishedAt), inline: true },
      { name: 'Country', value: snippet.country || 'Not listed', inline: true },
      { name: 'Handle', value: snippet.customUrl || 'Not listed', inline: true },
    )
    .setFooter({ text: 'Metadata supplied by YouTube Data API v3' })
    .setTimestamp();
  const thumbnail = snippet.thumbnails?.high?.url || snippet.thumbnails?.default?.url;
  if (thumbnail) embed.setThumbnail(thumbnail);
  if (banner) embed.setImage(`${banner}=w1060-fcrop64=1,00005a57ffffa5a8-k-c0xffffffff-no-nd-rj`);
  return embed;
}

module.exports = {
  data,
  async execute(interaction) {
    await interaction.deferReply({ flags: quiet(interaction) ? 64 : undefined });
    try {
      const type = interaction.options.getSubcommand();
      const result = await youtubeSearch(type, interaction.options.getString('query', true));
      await interaction.editReply({ embeds: [type === 'video' ? videoEmbed(result) : channelEmbed(result)] });
    } catch (error) {
      const message = error.friendly ? error.message : apiError(error, 'YouTube could not complete that search.');
      await interaction.editReply({ content: message });
    }
  },
};
