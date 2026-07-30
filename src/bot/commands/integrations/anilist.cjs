const { EmbedBuilder } = require('discord.js');
const { colors } = require('../../../utils/constants');
const { http, truncate, number } = require('./_shared.cjs');

const QUERY = `
query ($search: String!, $type: MediaType!) {
  Media(search: $search, type: $type, isAdult: false) {
    id title { romaji english native } description status episodes chapters volumes
    averageScore genres season seasonYear format siteUrl bannerImage
    coverImage { extraLarge color }
    studios(isMain: true) { nodes { name siteUrl } }
    staff(sort: RELEVANCE, perPage: 5) { nodes { name { full } siteUrl primaryOccupations } }
    externalLinks { site url type }
    startDate { year month day }
    endDate { year month day }
  }
}`;

function textFromHtml(value) {
  return String(value || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&#039;|&#x27;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim();
}

function mediaDate(value) {
  if (!value?.year) return 'Unknown';
  return [value.year, value.month && String(value.month).padStart(2, '0'), value.day && String(value.day).padStart(2, '0')].filter(Boolean).join('-');
}

async function getMedia(search, type) {
  const { data } = await http.post('https://graphql.anilist.co', { query: QUERY, variables: { search, type } }, {
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
  });
  if (data.errors?.length) {
    const error = new Error(data.errors[0].message || 'AniList rejected that search.');
    error.friendly = true;
    throw error;
  }
  if (!data.data?.Media) {
    const error = new Error(`No ${type.toLowerCase()} matched that search.`);
    error.friendly = true;
    throw error;
  }
  return data.data.Media;
}

function mediaEmbed(media, type) {
  const title = media.title.english || media.title.romaji || media.title.native;
  const altTitle = [media.title.romaji, media.title.native].filter(item => item && item !== title).join(' • ');
  const isAnime = type === 'ANIME';
  const creators = isAnime
    ? media.studios?.nodes?.map(item => `[${item.name}](${item.siteUrl})`) || []
    : media.staff?.nodes?.filter(item => item.primaryOccupations?.some(role => /manga|comic|author|artist/i.test(role))).map(item => `[${item.name.full}](${item.siteUrl})`) || [];
  const streaming = (media.externalLinks || []).filter(link => link.type === 'STREAMING').slice(0, 8);
  const links = streaming.length
    ? streaming.map(link => `[${link.site}](${link.url})`).join(' • ')
    : `[Open on AniList](${media.siteUrl})`;
  const count = isAnime
    ? `${media.episodes ? `${number(media.episodes)} episodes` : 'Episode count unknown'}`
    : `${media.chapters ? `${number(media.chapters)} chapters` : 'Chapter count unknown'}${media.volumes ? ` • ${number(media.volumes)} volumes` : ''}`;

  const embed = new EmbedBuilder()
    .setColor(media.coverImage?.color || colors.social)
    .setTitle(truncate(title, 256))
    .setURL(media.siteUrl)
    .setDescription(truncate(textFromHtml(media.description) || 'No synopsis is available.', 2000))
    .addFields(
      ...(altTitle ? [{ name: 'Also known as', value: truncate(altTitle), inline: false }] : []),
      { name: 'Format', value: String(media.format || 'Unknown').replaceAll('_', ' '), inline: true },
      { name: isAnime ? 'Episodes' : 'Publication', value: count, inline: true },
      { name: 'Score', value: media.averageScore ? `${media.averageScore}/100` : 'Not rated', inline: true },
      { name: 'Status', value: String(media.status || 'Unknown').replaceAll('_', ' '), inline: true },
      { name: 'Dates', value: `${mediaDate(media.startDate)} → ${mediaDate(media.endDate)}`, inline: true },
      { name: isAnime ? 'Studios' : 'Authors / artists', value: truncate(creators.length ? creators.join(', ') : 'Not listed'), inline: true },
      { name: 'Genres', value: truncate(media.genres?.length ? media.genres.join(' • ') : 'Not listed') },
      { name: isAnime ? 'Streaming / links' : 'Links', value: truncate(links) },
    )
    .setFooter({ text: 'Data supplied by AniList' })
    .setTimestamp();
  if (media.coverImage?.extraLarge) embed.setThumbnail(media.coverImage.extraLarge);
  if (media.bannerImage) embed.setImage(media.bannerImage);
  return embed;
}

module.exports = { getMedia, mediaEmbed };
