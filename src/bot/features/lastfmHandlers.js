const {
  AttachmentBuilder,
  EmbedBuilder,
  escapeMarkdown,
} = require('discord.js');
const axios = require('axios');
const sharp = require('sharp');
const lastfm = require('../../services/lastfmService');
const { dbAll, dbGet, dbRun } = require('../../database/db');
const { colors } = require('../../utils/constants');

const PERIOD_LABELS = {
  overall: 'All time',
  '7day': 'Weekly',
  '1month': 'Monthly',
  '3month': 'Quarterly',
  '6month': 'Half-year',
  '12month': 'Yearly',
};
const PERIOD_SECONDS = {
  '7day': 7 * 86400,
  '1month': 30 * 86400,
  '3month': 90 * 86400,
  '6month': 182 * 86400,
  '12month': 365 * 86400,
};
const MAX_GUILD_LINKS = 50;
let lastBulkRequestStart = 0;
let bulkRequestGate = Promise.resolve();

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatNumber(value) {
  return number(value).toLocaleString('en-US');
}

function text(value, max = 200) {
  const clean = String(value || 'Unknown').replace(/\s+/g, ' ').trim();
  return escapeMarkdown(clean || 'Unknown').slice(0, max);
}

function plainText(value, max = 1000) {
  return String(value || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function list(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function artistName(item) {
  if (typeof item?.artist === 'string') return item.artist;
  return item?.artist?.['#text'] || item?.artist?.name || item?.name || 'Unknown artist';
}

function largestImage(item) {
  const images = Array.isArray(item?.image) ? item.image : [];
  return [...images].reverse().map(image => image?.['#text']).find(Boolean) || null;
}

function safeUrl(value, fallback = null) {
  try {
    const url = new URL(String(value || ''));
    return ['http:', 'https:'].includes(url.protocol) ? url.toString() : fallback;
  } catch {
    return fallback;
  }
}

function lastFmProfileUrl(username) {
  return `https://www.last.fm/user/${encodeURIComponent(username)}`;
}

function linkedLabel(label, url, max = 160) {
  const safeLabel = text(label, max);
  const target = safeUrl(url);
  return target ? `[${safeLabel}](${target})` : safeLabel;
}

function period(interaction, fallback = '7day') {
  return interaction.options.getString('period') || fallback;
}

function targetLink(interaction) {
  const discordUser = interaction.options.getUser('user') || interaction.user;
  const link = dbGet('SELECT lastfm_username FROM lastfm_users WHERE user_id = ?', [discordUser.id]);
  if (!link) {
    const subject = discordUser.id === interaction.user.id ? 'You have' : 'That user has';
    throw new Error(`${subject} not linked a Last.fm account. Use \`.login username\` or \`/lastfm set\` first.`);
  }
  return { discordUser, username: link.lastfm_username };
}

async function currentScrobble(target) {
  const tracks = await lastfm.getRecentTracks(target.username, 1);
  if (!tracks.length) throw new Error(`${target.username} has no recent scrobbles.`);
  const track = tracks[0];
  return {
    track,
    artist: track.artist?.['#text'] || track.artist?.name,
    album: track.album?.['#text'] || track.album?.name,
    trackName: track.name,
  };
}

async function resolveArtist(interaction) {
  const target = targetLink(interaction);
  const provided = interaction.options.getString('artist')?.trim();
  if (provided) return { target, artist: provided };
  const current = await currentScrobble(target);
  if (!current.artist) throw new Error('The latest scrobble has no artist information.');
  return { target, artist: current.artist };
}

async function resolveAlbum(interaction) {
  const target = targetLink(interaction);
  const providedArtist = interaction.options.getString('artist')?.trim();
  const providedAlbum = interaction.options.getString('album')?.trim();
  if (providedArtist || providedAlbum) {
    if (!providedArtist && providedAlbum) {
      const results = await lastfm.searchAlbum(providedAlbum, { limit: 5 });
      const match = results.items.find(item => item?.artist && item?.name);
      if (!match) throw new Error(`No Last.fm album matched “${providedAlbum}”. Try \`artist | album\`.`);
      return { target, artist: match.artist, album: match.name };
    }
    if (!providedAlbum) throw new Error('Provide an album query, use `artist | album`, or leave both fields blank to use the latest scrobble.');
    return { target, artist: providedArtist, album: providedAlbum };
  }
  const current = await currentScrobble(target);
  if (!current.artist || !current.album) throw new Error('The latest scrobble does not include an album.');
  return { target, artist: current.artist, album: current.album };
}

async function resolveTrack(interaction) {
  const target = targetLink(interaction);
  const providedArtist = interaction.options.getString('artist')?.trim();
  const providedTrack = interaction.options.getString('track')?.trim();
  if (providedArtist || providedTrack) {
    if (!providedArtist && providedTrack) {
      const results = await lastfm.searchTrack(providedTrack, { limit: 5 });
      const match = results.items.find(item => item?.artist && item?.name);
      if (!match) throw new Error(`No Last.fm track matched “${providedTrack}”. Try \`artist | track\`.`);
      return { target, artist: match.artist, track: match.name };
    }
    if (!providedTrack) throw new Error('Provide a track query, use `artist | track`, or leave both fields blank to use the latest scrobble.');
    return { target, artist: providedArtist, track: providedTrack };
  }
  const current = await currentScrobble(target);
  if (!current.artist || !current.trackName) throw new Error('The latest scrobble has incomplete track information.');
  return { target, artist: current.artist, track: current.trackName };
}

function baseEmbed(title) {
  return new EmbedBuilder()
    .setColor(colors.muted)
    .setTitle(title.slice(0, 256));
}

function userAuthor(embed, target, label) {
  return embed.setAuthor({
    name: `${target.username} — ${label}`.slice(0, 256),
    iconURL: target.discordUser.displayAvatarURL(),
    url: lastFmProfileUrl(target.username),
  });
}

async function setAccount(interaction) {
  const requested = interaction.options.getString('username').trim();
  const info = await lastfm.getUserInfo(requested);
  const username = info.name || requested;
  const existing = dbGet('SELECT user_id FROM lastfm_users WHERE user_id = ?', [interaction.user.id]);
  if (existing) dbRun('UPDATE lastfm_users SET lastfm_username = ? WHERE user_id = ?', [username, interaction.user.id]);
  else dbRun('INSERT INTO lastfm_users (user_id, lastfm_username) VALUES (?, ?)', [interaction.user.id, username]);

  await interaction.editReply({
    embeds: [baseEmbed('Last.fm account linked')
      .setColor(colors.lastfm)
      .setDescription(`Linked ${interaction.user} to [${text(username, 100)}](https://www.last.fm/user/${encodeURIComponent(username)}).`)],
  });
}

async function removeAccount(interaction) {
  const existing = dbGet('SELECT lastfm_username FROM lastfm_users WHERE user_id = ?', [interaction.user.id]);
  if (!existing) throw new Error('You do not have a linked Last.fm account.');
  dbRun('DELETE FROM lastfm_users WHERE user_id = ?', [interaction.user.id]);
  await interaction.editReply({
    embeds: [baseEmbed('Last.fm link removed')
      .setColor(colors.lastfm)
      .setDescription(`Removed the locally stored link to **${text(existing.lastfm_username, 100)}**.`)],
  });
}

async function nowPlaying(interaction) {
  const target = targetLink(interaction);
  const [{ track }, user] = await Promise.all([
    currentScrobble(target),
    lastfm.getUserInfo(target.username),
  ]);
  const embed = buildNowPlayingEmbed(target, track, user.playcount);
  await interaction.editReply({ embeds: [embed] });
}

function buildNowPlayingEmbed(target, track, totalScrobbles) {
  const isPlaying = track['@attr']?.nowplaying === 'true';
  const image = largestImage(track);
  const username = plainText(target.username, 100) || 'Last.fm user';
  const profileUrl = `https://www.last.fm/user/${encodeURIComponent(target.username)}`;
  const trackUrl = /^https?:\/\//.test(track.url || '') ? track.url : profileUrl;
  const album = track.album?.['#text'] || track.album?.name || 'Album unavailable';
  const embed = new EmbedBuilder()
    .setColor(colors.muted)
    .setAuthor({
      name: `${isPlaying ? 'Now playing for' : 'Most recent scrobble for'} ${username}`.slice(0, 256),
      iconURL: target.discordUser.displayAvatarURL(),
      url: profileUrl,
    })
    .setTitle(plainText(track.name, 256) || 'Unknown track')
    .setURL(trackUrl)
    .setDescription(`**${text(artistName(track), 300)}**\n*${text(album, 300)}*`)
    .setFooter({
      text: `${formatNumber(totalScrobbles)} total scrobbles${isPlaying ? '' : ' • Last played'} • Last.fm`,
    });
  if (image) embed.setThumbnail(image);
  return embed;
}

async function profile(interaction) {
  const target = targetLink(interaction);
  const user = await lastfm.getUserInfo(target.username);
  const registered = number(user.registered?.unixtime);
  const embed = userAuthor(baseEmbed('Last.fm profile'), target, 'Profile')
    .setURL(user.url || `https://www.last.fm/user/${encodeURIComponent(target.username)}`)
    .addFields(
      { name: 'Scrobbles', value: formatNumber(user.playcount), inline: true },
      { name: 'Artists', value: formatNumber(user.artist_count), inline: true },
      { name: 'Albums', value: formatNumber(user.album_count), inline: true },
      { name: 'Tracks', value: formatNumber(user.track_count), inline: true },
      { name: 'Country', value: text(user.country || 'Unknown', 100), inline: true },
      { name: 'Registered', value: registered ? `<t:${registered}:D>` : 'Unknown', inline: true },
    );
  const image = largestImage(user);
  if (image) embed.setThumbnail(image);
  await interaction.editReply({ embeds: [embed] });
}

async function recent(interaction) {
  const target = targetLink(interaction);
  const requestedLimit = interaction.options.getInteger('limit') || 10;
  const artistFilter = interaction.options.getString('artist')?.trim().toLowerCase();
  const tracks = await lastfm.getRecentTracks(target.username, artistFilter ? 200 : requestedLimit);
  const selected = tracks.filter(track => !artistFilter || artistName(track).toLowerCase().includes(artistFilter)).slice(0, requestedLimit);
  if (!selected.length) throw new Error(artistFilter ? `No recent scrobbles matched “${artistFilter}”.` : 'No recent scrobbles found.');

  const lines = selected.map((track, index) => {
    const when = track['@attr']?.nowplaying === 'true'
      ? '**now playing**'
      : track.date?.uts ? `<t:${track.date.uts}:R>` : 'unknown time';
    return `${index + 1}. ${linkedLabel(track.name, track.url, 70)} by ${text(artistName(track), 70)} — ${when}`;
  });
  const embed = baseEmbed(`Recent scrobbles for ${plainText(target.username, 100)}`)
    .setURL(lastFmProfileUrl(target.username))
    .setDescription(`${lines.join('\n')}\n\nRecent — **${selected.length} scrobbles**`.slice(0, 4096));
  const image = largestImage(selected[0]);
  if (image) embed.setThumbnail(image);
  await interaction.editReply({ embeds: [embed] });
}

async function plays(interaction) {
  const target = targetLink(interaction);
  const selectedPeriod = period(interaction, 'overall');
  let count;
  if (selectedPeriod === 'overall') {
    count = number((await lastfm.getUserInfo(target.username)).playcount);
  } else {
    const from = Math.floor(Date.now() / 1000) - PERIOD_SECONDS[selectedPeriod];
    count = (await lastfm.getRecentTracksPage(target.username, { limit: 1, from })).pagination.total;
  }
  await interaction.editReply({
    embeds: [userAuthor(baseEmbed('Scrobble count'), target, PERIOD_LABELS[selectedPeriod])
      .setDescription(`**${formatNumber(count)}** scrobbles during **${PERIOD_LABELS[selectedPeriod].toLowerCase()}**.`)],
  });
}

async function overview(interaction) {
  const target = targetLink(interaction);
  const days = interaction.options.getInteger('days') || 4;
  const from = Math.floor(Date.now() / 1000) - days * 86400;
  const first = await lastfm.getRecentTracksPage(target.username, { limit: 200, page: 1, from });
  const pagesToLoad = Math.min(Math.max(first.pagination.totalPages, 1), 20);
  const tracks = [...first.tracks];
  for (let page = 2; page <= pagesToLoad; page += 1) {
    tracks.push(...(await lastfm.getRecentTracksPage(target.username, { limit: 200, page, from })).tracks);
  }
  const scrobbles = tracks.filter(track => track.date?.uts);
  if (!scrobbles.length) throw new Error(`No completed scrobbles were found in the last ${days} day${days === 1 ? '' : 's'}.`);

  const topArtist = topFrequency(scrobbles, track => artistName(track));
  const topAlbum = topFrequency(scrobbles.filter(track => track.album?.['#text']), track => `${artistName(track)} — ${track.album['#text']}`);
  const topTrack = topFrequency(scrobbles, track => `${artistName(track)} — ${track.name}`);
  const embed = userAuthor(baseEmbed(`${days}-day listening overview`), target, 'Overview')
    .addFields(
      { name: 'Completed scrobbles', value: formatNumber(scrobbles.length), inline: true },
      { name: 'Top artist', value: `${text(topArtist.name, 200)}\n${formatNumber(topArtist.count)} plays`, inline: false },
      { name: 'Top album', value: topAlbum.name ? `${text(topAlbum.name, 200)}\n${formatNumber(topAlbum.count)} plays` : 'No album data', inline: false },
      { name: 'Top track', value: `${text(topTrack.name, 200)}\n${formatNumber(topTrack.count)} plays`, inline: false },
    );
  if (first.pagination.totalPages > pagesToLoad) {
    embed.setFooter({ text: `Partial overview: loaded ${scrobbles.length} of ${first.pagination.total} scrobbles • Last.fm` });
  }
  await interaction.editReply({ embeds: [embed] });
}

function topFrequency(items, selector) {
  const counts = new Map();
  for (const item of items) {
    const name = String(selector(item) || '').trim();
    if (!name) continue;
    const key = name.normalize('NFKC').toLowerCase();
    const current = counts.get(key) || { name, count: 0 };
    current.count += 1;
    counts.set(key, current);
  }
  return [...counts.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))[0] || { name: '', count: 0 };
}

async function topList(interaction, kind) {
  const target = targetLink(interaction);
  const selectedPeriod = period(interaction, '7day');
  const limit = interaction.options.getInteger('limit') || 10;
  const methods = {
    artists: lastfm.getTopArtists,
    albums: lastfm.getTopAlbums,
    tracks: lastfm.getTopTracks,
  };
  const items = await methods[kind](target.username, { period: selectedPeriod, limit });
  if (!items.length) throw new Error(`No top ${kind} were returned for this period.`);
  await interaction.editReply({ embeds: [buildTopListEmbed(target, items, kind, selectedPeriod)] });
}

function buildTopListEmbed(target, items, kind, selectedPeriod) {
  const profileUrl = lastFmProfileUrl(target.username);
  const lines = items.map((item, index) => {
    const label = kind === 'artists' ? item.name : `${item.name} by ${artistName(item)}`;
    return `${index + 1}. ${linkedLabel(label, item.url, 120)} — **${formatNumber(item.playcount)} plays**`;
  });
  const listedPlays = items.reduce((total, item) => total + number(item.playcount), 0);
  const typeLabel = kind[0].toUpperCase() + kind.slice(1);
  const embed = baseEmbed(`${PERIOD_LABELS[selectedPeriod]} top ${kind} for ${plainText(target.username, 100)}`)
    .setURL(profileUrl)
    .setDescription(`${lines.join('\n')}\n\n${typeLabel} — **${items.length} listed** — **${formatNumber(listedPlays)} plays**`.slice(0, 4096));
  const image = largestImage(items[0]);
  if (image) embed.setThumbnail(image);
  return embed;
}

async function receipt(interaction) {
  const target = targetLink(interaction);
  const selectedPeriod = period(interaction, '7day');
  const tracks = await lastfm.getTopTracks(target.username, { period: selectedPeriod, limit: 10 });
  if (!tracks.length) throw new Error('No tracks were returned for this period.');
  const listedPlays = tracks.reduce((sum, track) => sum + number(track.playcount), 0);
  const rows = tracks.map((track, index) => `${String(index + 1).padStart(2, '0')}  ${plainText(track.name, 24).padEnd(24)} ${String(number(track.playcount)).padStart(6)}`);
  const body = [
    'LAST.FM RECEIPT',
    target.username.toUpperCase().slice(0, 36),
    PERIOD_LABELS[selectedPeriod].toUpperCase(),
    '--------------------------------',
    ...rows,
    '--------------------------------',
    `LISTED PLAYS ${formatNumber(listedPlays)}`,
  ].join('\n');
  await interaction.editReply({
    embeds: [userAuthor(baseEmbed('Listening receipt'), target, PERIOD_LABELS[selectedPeriod])
      .setDescription(`\`\`\`text\n${body.slice(0, 3800)}\n\`\`\``)],
  });
}

async function artistInfo(interaction) {
  const { target, artist } = await resolveArtist(interaction);
  const info = await lastfm.getArtistInfo(artist, { username: target.username });
  const tags = list(info.tags?.tag).slice(0, 6).map(tag => text(tag.name, 40)).join(' • ') || 'No tags';
  const embed = baseEmbed(text(info.name || artist, 250))
    .setURL(info.url)
    .addFields(
      { name: 'Listeners', value: formatNumber(info.stats?.listeners), inline: true },
      { name: 'Global plays', value: formatNumber(info.stats?.playcount), inline: true },
      { name: `${text(target.username, 80)} plays`, value: formatNumber(info.stats?.userplaycount), inline: true },
      { name: 'Tags', value: tags, inline: false },
    );
  const summary = plainText(info.bio?.summary, 1000);
  if (summary) embed.setDescription(summary);
  const image = largestImage(info);
  if (image) embed.setThumbnail(image);
  await interaction.editReply({ embeds: [embed] });
}

async function albumInfo(interaction) {
  const { target, artist, album } = await resolveAlbum(interaction);
  const info = await lastfm.getAlbumInfo(artist, album, { username: target.username });
  const tracks = list(info.tracks?.track);
  const embed = baseEmbed(text(info.name || album, 250))
    .setURL(info.url)
    .setDescription(`**Artist:** ${text(info.artist || artist, 200)}`)
    .addFields(
      { name: 'Listeners', value: formatNumber(info.listeners), inline: true },
      { name: 'Global plays', value: formatNumber(info.playcount), inline: true },
      { name: `${text(target.username, 80)} plays`, value: formatNumber(info.userplaycount), inline: true },
      { name: 'Tracks', value: formatNumber(tracks.length), inline: true },
    );
  const image = largestImage(info);
  if (image) embed.setThumbnail(image);
  await interaction.editReply({ embeds: [embed] });
}

async function trackInfo(interaction) {
  const { target, artist, track } = await resolveTrack(interaction);
  const info = await lastfm.getTrackInfo(artist, track, { username: target.username });
  const duration = number(info.duration);
  const tags = list(info.toptags?.tag).slice(0, 6).map(tag => text(tag.name, 40)).join(' • ') || 'No tags';
  const embed = baseEmbed(text(info.name || track, 250))
    .setURL(info.url)
    .setDescription(`**Artist:** ${text(info.artist?.name || artist, 200)}${info.album?.title ? `\n**Album:** ${text(info.album.title, 200)}` : ''}`)
    .addFields(
      { name: 'Listeners', value: formatNumber(info.listeners), inline: true },
      { name: 'Global plays', value: formatNumber(info.playcount), inline: true },
      { name: `${text(target.username, 80)} plays`, value: formatNumber(info.userplaycount), inline: true },
      { name: 'Duration', value: duration ? formatDuration(duration) : 'Unknown', inline: true },
      { name: 'Tags', value: tags, inline: false },
    );
  const summary = plainText(info.wiki?.summary, 700);
  if (summary) embed.addFields({ name: 'About', value: summary, inline: false });
  const image = largestImage(info.album);
  if (image) embed.setThumbnail(image);
  await interaction.editReply({ embeds: [embed] });
}

function formatDuration(milliseconds) {
  const seconds = Math.round(milliseconds / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

async function entityPlays(interaction, kind) {
  const resolved = kind === 'artist' ? await resolveArtist(interaction)
    : kind === 'album' ? await resolveAlbum(interaction)
      : await resolveTrack(interaction);
  const info = kind === 'artist'
    ? await lastfm.getArtistInfo(resolved.artist, { username: resolved.target.username })
    : kind === 'album'
      ? await lastfm.getAlbumInfo(resolved.artist, resolved.album, { username: resolved.target.username })
      : await lastfm.getTrackInfo(resolved.artist, resolved.track, { username: resolved.target.username });
  const name = kind === 'artist' ? info.name
    : kind === 'album' ? `${info.artist || resolved.artist} — ${info.name}`
      : `${info.artist?.name || resolved.artist} — ${info.name}`;
  const count = kind === 'artist' ? info.stats?.userplaycount : info.userplaycount;
  await interaction.editReply({
    embeds: [userAuthor(baseEmbed(`${kind[0].toUpperCase()}${kind.slice(1)} plays`), resolved.target, 'All time')
      .setDescription(`**${text(name, 300)}**\n${formatNumber(count)} plays`)],
  });
}

async function albumTracks(interaction) {
  const resolved = await resolveAlbum(interaction);
  const info = await lastfm.getAlbumInfo(resolved.artist, resolved.album, { username: resolved.target.username });
  const tracks = list(info.tracks?.track).slice(0, 20);
  if (!tracks.length) throw new Error('Last.fm did not return a tracklist for this album.');
  const withCounts = await mapLimit(tracks, 3, async track => {
    try {
      const details = await limitedLastFmRequest(() => lastfm.getTrackInfo(
        resolved.artist,
        track.name,
        { username: resolved.target.username },
      ));
      return { name: track.name, plays: number(details.userplaycount) };
    } catch {
      return { name: track.name, plays: null };
    }
  });
  const lines = withCounts.map((track, index) => `${index + 1}. ${text(track.name, 140)} — ${track.plays === null ? 'unavailable' : `**${formatNumber(track.plays)} plays**`}`);
  const counted = withCounts.filter(track => track.plays !== null);
  const totalPlays = counted.reduce((total, track) => total + track.plays, 0);
  const embed = baseEmbed(`${text(info.name || resolved.album, 180)} by ${text(info.artist || resolved.artist, 120)}`)
    .setURL(safeUrl(info.url, lastFmProfileUrl(resolved.target.username)))
    .setDescription(`${lines.join('\n')}\n\nAlbum — **${counted.length} tracks counted** — **${formatNumber(totalPlays)} plays**`.slice(0, 4096));
  if (list(info.tracks?.track).length > tracks.length) {
    embed.setFooter({ text: `Showing the first ${tracks.length} tracks • Live data from Last.fm` });
  }
  const image = largestImage(info);
  if (image) embed.setThumbnail(image);
  await interaction.editReply({ embeds: [embed] });
}

async function cover(interaction) {
  const resolved = await resolveAlbum(interaction);
  const info = await lastfm.getAlbumInfo(resolved.artist, resolved.album, { username: resolved.target.username });
  const image = largestImage(info);
  if (!image) throw new Error('Last.fm did not return cover artwork for this album.');
  await interaction.editReply({
    embeds: [baseEmbed(text(info.name || resolved.album, 250))
      .setURL(info.url)
      .setDescription(`**Artist:** ${text(info.artist || resolved.artist, 200)}`)
      .setImage(image)],
  });
}

async function loved(interaction) {
  const target = targetLink(interaction);
  const limit = interaction.options.getInteger('limit') || 10;
  const tracks = await lastfm.getLovedTracks(target.username, { limit });
  if (!tracks.length) throw new Error('No loved tracks were returned.');
  const lines = tracks.map((track, index) => `${index + 1}. ${linkedLabel(track.name, track.url, 65)} by ${text(artistName(track), 65)}`);
  const embed = baseEmbed(`Loved tracks for ${plainText(target.username, 100)}`)
    .setURL(lastFmProfileUrl(target.username))
    .setDescription(`${lines.join('\n')}\n\nTracks — **${tracks.length} loved**`.slice(0, 4096));
  const image = largestImage(tracks[0]);
  if (image) embed.setThumbnail(image);
  await interaction.editReply({ embeds: [embed] });
}

async function chart(interaction) {
  const target = targetLink(interaction);
  const selectedPeriod = period(interaction, '7day');
  const size = interaction.options.getString('size') || '3x3';
  const [width, height] = size.split('x').map(Number);
  const albums = await lastfm.getTopAlbums(target.username, { period: selectedPeriod, limit: width * height });
  if (!albums.length) throw new Error('No albums were returned for this period.');
  const buffer = await createAlbumChart(albums, width, height);
  const filename = `lastfm_${target.username.replace(/[^a-z0-9_-]/gi, '_').slice(0, 40)}_${size}.jpg`;
  const attachment = new AttachmentBuilder(buffer, { name: filename });
  await interaction.editReply({
    embeds: [userAuthor(baseEmbed(`Top albums • ${size}`), target, PERIOD_LABELS[selectedPeriod])
      .setImage(`attachment://${filename}`)],
    files: [attachment],
  });
}

async function createAlbumChart(albums, width, height) {
  const tileSize = 280;
  const slots = width * height;
  const tiles = await mapLimit(Array.from({ length: slots }, (_, index) => albums[index] || null), 5, async album => {
    const image = largestImage(album);
    if (image) {
      try {
        const response = await axios.get(image, { responseType: 'arraybuffer', timeout: 10000, maxContentLength: 10 * 1024 * 1024 });
        return await sharp(response.data).resize(tileSize, tileSize, { fit: 'cover' }).png().toBuffer();
      } catch { }
    }
    return placeholderTile(album, tileSize);
  });
  return sharp({
    create: { width: width * tileSize, height: height * tileSize, channels: 3, background: '#171722' },
  }).composite(tiles.map((input, index) => ({
    input,
    left: (index % width) * tileSize,
    top: Math.floor(index / width) * tileSize,
  }))).jpeg({ quality: 88, mozjpeg: true }).toBuffer();
}

function placeholderTile(album, size) {
  const albumName = xmlEscape(plainText(album?.name || 'No album', 28));
  const artist = xmlEscape(plainText(artistName(album), 28));
  return sharp(Buffer.from(`<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
    <rect width="100%" height="100%" fill="#27273b"/>
    <text x="20" y="125" fill="#ffffff" font-family="Arial" font-size="20" font-weight="700">${albumName}</text>
    <text x="20" y="155" fill="#a78bfa" font-family="Arial" font-size="16">${artist}</text>
  </svg>`)).png().toBuffer();
}

function xmlEscape(value) {
  return String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[character]);
}

async function guildLinkedAccounts(interaction) {
  if (!interaction.guild) throw new Error('This subcommand only works in a server because it compares linked server members.');
  const rows = dbAll('SELECT user_id, lastfm_username FROM lastfm_users');
  const memberships = await mapLimit(rows, 10, async row => {
    const member = interaction.guild.members.cache.get(row.user_id)
      || await interaction.guild.members.fetch(row.user_id).catch(() => null);
    return member ? { member, username: row.lastfm_username } : null;
  });
  const present = memberships.filter(Boolean);
  const deduplicated = new Map();
  for (const entry of present) {
    const key = entry.username.normalize('NFKC').trim().toLowerCase();
    if (!deduplicated.has(key)) deduplicated.set(key, { ...entry, members: [entry.member] });
    else deduplicated.get(key).members.push(entry.member);
  }
  const accounts = [...deduplicated.values()];
  if (accounts.length > MAX_GUILD_LINKS) {
    throw new Error(`This server has ${accounts.length} linked Last.fm accounts. The live comparison limit is ${MAX_GUILD_LINKS}.`);
  }
  if (!accounts.length) throw new Error('No linked Last.fm accounts were found among members of this server.');
  return accounts;
}

async function whoKnows(interaction, kind) {
  if (!interaction.guild) throw new Error('This subcommand only works in a server because it compares linked server members.');
  const resolved = await resolveWhoKnowsInput(interaction, kind);
  const accounts = await guildLinkedAccounts(interaction);
  let canonical;
  if (kind === 'artist') canonical = await lastfm.getArtistInfo(resolved.artist);
  else if (kind === 'album') canonical = await lastfm.getAlbumInfo(resolved.artist, resolved.album);
  else canonical = await lastfm.getTrackInfo(resolved.artist, resolved.track);

  const results = await mapLimit(accounts, 3, async account => {
    try {
      const info = await limitedLastFmRequest(() => kind === 'artist'
        ? lastfm.getArtistInfo(canonical.name || resolved.artist, { username: account.username })
        : kind === 'album'
          ? lastfm.getAlbumInfo(canonical.artist || resolved.artist, canonical.name || resolved.album, { username: account.username })
          : lastfm.getTrackInfo(canonical.artist?.name || resolved.artist, canonical.name || resolved.track, { username: account.username }));
      const plays = number(kind === 'artist' ? info.stats?.userplaycount : info.userplaycount);
      return { account, plays, responded: true };
    } catch {
      return { account, plays: 0, responded: false };
    }
  });
  const responded = results.filter(result => result.responded);
  const ranked = responded.filter(result => result.plays > 0).sort((a, b) => b.plays - a.plays);
  const embed = buildWhoKnowsEmbed({ interaction, kind, canonical, resolved, ranked, responded });
  await interaction.editReply({ embeds: [embed] });
}

function buildWhoKnowsEmbed({ interaction, kind, canonical, resolved, ranked, responded }) {
  const canonicalArtist = kind === 'artist'
    ? canonical.name
    : kind === 'album'
      ? canonical.artist || resolved.artist
      : canonical.artist?.name || resolved.artist;
  const canonicalName = canonical.name || (kind === 'album' ? resolved.album : kind === 'track' ? resolved.track : resolved.artist);
  const entityName = kind === 'artist' ? canonicalName : `${canonicalName} by ${canonicalArtist}`;
  const guildName = plainText(interaction.guild.name, 80) || 'this server';
  const title = `${entityName} in ${guildName}`;
  const canonicalUrl = safeUrl(canonical.url);
  const embed = baseEmbed(plainText(title, 256));
  if (canonicalUrl) embed.setURL(canonicalUrl);
  if (ranked.length) {
    const totalPlays = ranked.reduce((total, result) => total + result.plays, 0);
    const average = Math.round(totalPlays / ranked.length);
    const typeLabel = kind[0].toUpperCase() + kind.slice(1);
    const rows = ranked.slice(0, 20).map((result, index) => {
      const username = plainText(result.account.username, 80) || 'Last.fm user';
      return `${index + 1}. ${linkedLabel(username, lastFmProfileUrl(result.account.username), 80)} — **${formatNumber(result.plays)} plays**`;
    });
    embed.setDescription(`${rows.join('\n')}\n\n${typeLabel} — **${ranked.length} listeners** — **${formatNumber(totalPlays)} plays** — **${formatNumber(average)} avg**`.slice(0, 4096));
  } else {
    embed.setDescription(`None of the ${responded.length} linked accounts that responded has an all-time Last.fm playcount for **${text(entityName, 300)}**.`);
  }
  const artwork = kind === 'track' ? largestImage(canonical.album) : largestImage(canonical);
  if (artwork) embed.setThumbnail(artwork);
  return embed;
}

async function resolveWhoKnowsInput(interaction, kind) {
  const artist = interaction.options.getString('artist')?.trim();
  const album = interaction.options.getString('album')?.trim();
  const track = interaction.options.getString('track')?.trim();
  if (kind === 'artist' && artist) return { artist };
  if (kind === 'album' && (artist || album)) {
    if (!artist && album) {
      const results = await lastfm.searchAlbum(album, { limit: 5 });
      const match = results.items.find(item => item?.artist && item?.name);
      if (!match) throw new Error(`No Last.fm album matched “${album}”. Try \`artist | album\`.`);
      return { artist: match.artist, album: match.name };
    }
    if (!album) throw new Error('Provide an album query, use `artist | album`, or leave both fields blank to use your latest scrobble.');
    return { artist, album };
  }
  if (kind === 'track' && (artist || track)) {
    if (!artist && track) {
      const results = await lastfm.searchTrack(track, { limit: 5 });
      const match = results.items.find(item => item?.artist && item?.name);
      if (!match) throw new Error(`No Last.fm track matched “${track}”. Try \`artist | track\`.`);
      return { artist: match.artist, track: match.name };
    }
    if (!track) throw new Error('Provide a track query, use `artist | track`, or leave both fields blank to use your latest scrobble.');
    return { artist, track };
  }
  const target = targetLink(interaction);
  const current = await currentScrobble(target);
  if (kind === 'album' && !current.album) throw new Error('Your latest scrobble does not include an album.');
  return { artist: current.artist, album: current.album, track: current.trackName };
}

function limitedLastFmRequest(task, retry = true) {
  const gate = bulkRequestGate.then(async () => {
    const wait = Math.max(0, 500 - (Date.now() - lastBulkRequestStart));
    if (wait) await new Promise(resolve => setTimeout(resolve, wait));
    lastBulkRequestStart = Date.now();
  });
  bulkRequestGate = gate.catch(() => {});
  return gate.then(task).catch(async error => {
    if (!retry || !error?.retryable) throw error;
    await new Promise(resolve => setTimeout(resolve, 1000));
    return limitedLastFmRequest(task, false);
  });
}

async function mapLimit(items, concurrency, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

const handlers = {
  set: setAccount,
  np: nowPlaying,
  remove: removeAccount,
  profile,
  recent,
  plays,
  overview,
  topartists: interaction => topList(interaction, 'artists'),
  topalbums: interaction => topList(interaction, 'albums'),
  toptracks: interaction => topList(interaction, 'tracks'),
  chart,
  receipt,
  artist: artistInfo,
  album: albumInfo,
  track: trackInfo,
  artistplays: interaction => entityPlays(interaction, 'artist'),
  albumplays: interaction => entityPlays(interaction, 'album'),
  trackplays: interaction => entityPlays(interaction, 'track'),
  albumtracks: albumTracks,
  cover,
  loved,
  whoknows: interaction => whoKnows(interaction, 'artist'),
  whoknowsalbum: interaction => whoKnows(interaction, 'album'),
  whoknowstrack: interaction => whoKnows(interaction, 'track'),
};

module.exports = {
  handlers,
  buildNowPlayingEmbed,
  buildTopListEmbed,
  buildWhoKnowsEmbed,
  createAlbumChart,
  topFrequency,
};
