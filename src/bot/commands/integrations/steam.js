const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { colors } = require('../../../utils/constants');
const { http, addQuiet, truncate, number, dateTime, apiError, quiet } = require('./_shared.cjs');

const data = new SlashCommandBuilder()
  .setName('steam')
  .setDescription('Show Steam profiles, games, playtime, achievements, and store details')
  .addSubcommand(subcommand => addQuiet(subcommand
    .setName('profile')
    .setDescription('Show a public Steam profile and recently played games')
    .addStringOption(option => option.setName('user').setDescription('Steam ID64, vanity name, or profile URL').setRequired(true).setMaxLength(200))))
  .addSubcommand(subcommand => addQuiet(subcommand
    .setName('game')
    .setDescription('Show Steam store information for an app')
    .addIntegerOption(option => option.setName('appid').setDescription('Steam app ID, such as 730').setRequired(true).setMinValue(1))))
  .addSubcommand(subcommand => addQuiet(subcommand
    .setName('achievements')
    .setDescription('Show a player’s public achievements for a game')
    .addStringOption(option => option.setName('user').setDescription('Steam ID64, vanity name, or profile URL').setRequired(true).setMaxLength(200))
    .addIntegerOption(option => option.setName('appid').setDescription('Steam app ID').setRequired(true).setMinValue(1))));

function key() {
  if (!process.env.STEAM_API_KEY) {
    const error = new Error('Steam profile data requires `STEAM_API_KEY` in `.env`. `/steam game` works without it.');
    error.friendly = true;
    throw error;
  }
  return process.env.STEAM_API_KEY;
}

async function steamId(input) {
  const value = input.trim();
  const direct = value.match(/(?:profiles\/)?(\d{17})/);
  if (direct) return direct[1];
  const vanity = value.match(/steamcommunity\.com\/id\/([^/?#]+)/i)?.[1] || value.replace(/^@/, '');
  if (!/^[\w-]{2,64}$/.test(vanity)) {
    const error = new Error('Enter a Steam ID64, vanity name, or Steam Community profile URL.');
    error.friendly = true;
    throw error;
  }
  const { data } = await http.get('https://api.steampowered.com/ISteamUser/ResolveVanityURL/v1/', {
    params: { key: key(), vanityurl: vanity },
  });
  if (data.response?.success !== 1 || !data.response.steamid) {
    const error = new Error(data.response?.message || 'That Steam profile could not be resolved.');
    error.friendly = true;
    throw error;
  }
  return data.response.steamid;
}

function playtime(minutes = 0) {
  const hours = minutes / 60;
  return hours < 1 ? `${minutes}m` : `${hours.toFixed(hours >= 100 ? 0 : 1)}h`;
}

function personaState(value) {
  return ['Offline', 'Online', 'Busy', 'Away', 'Snooze', 'Looking to trade', 'Looking to play'][value] || 'Unknown';
}

async function profileEmbed(input) {
  const id = await steamId(input);
  const apiKey = key();
  const [summaryResult, recentResult] = await Promise.all([
    http.get('https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/', { params: { key: apiKey, steamids: id } }),
    http.get('https://api.steampowered.com/IPlayerService/GetRecentlyPlayedGames/v1/', { params: { key: apiKey, steamid: id, count: 5 } }).catch(() => ({ data: {} })),
  ]);
  const player = summaryResult.data.response?.players?.[0];
  if (!player) {
    const error = new Error('That Steam profile was not found or is not publicly available.');
    error.friendly = true;
    throw error;
  }
  const games = recentResult.data.response?.games || [];
  const recent = games.length
    ? games.map(game => `**[${game.name}](https://store.steampowered.com/app/${game.appid})** · ${playtime(game.playtime_2weeks || 0)} recently · ${playtime(game.playtime_forever)} total`).join('\n')
    : 'No public recently played games.';
  const embed = new EmbedBuilder()
    .setColor(colors.utility)
    .setTitle(player.personaname)
    .setURL(player.profileurl)
    .setThumbnail(player.avatarfull)
    .setDescription(truncate(player.realname ? `**${player.realname}**${player.loccountrycode ? ` • ${player.loccountrycode}` : ''}` : player.loccountrycode || 'Public Steam profile'))
    .addFields(
      { name: 'Steam ID64', value: `\`${player.steamid}\``, inline: true },
      { name: 'Status', value: personaState(player.personastate), inline: true },
      { name: 'Account created', value: player.timecreated ? dateTime(player.timecreated * 1000) : 'Not published', inline: true },
      { name: 'Recently played', value: truncate(recent, 1024) },
    )
    .setFooter({ text: 'Only information exposed by the player’s Steam privacy settings is shown.' })
    .setTimestamp();
}

async function gameEmbed(appid) {
  const { data: response } = await http.get('https://store.steampowered.com/api/appdetails', {
    params: { appids: appid, l: 'english', cc: 'us' },
  });
  const result = response[String(appid)];
  if (!result?.success || !result.data) {
    const error = new Error('That Steam app was not found or is unavailable in the store.');
    error.friendly = true;
    throw error;
  }
  const game = result.data;
  const price = game.is_free ? 'Free to play' : game.price_overview?.final_formatted || 'Not currently priced';
  return new EmbedBuilder()
    .setColor(colors.utility)
    .setTitle(truncate(game.name, 256))
    .setURL(`https://store.steampowered.com/app/${appid}`)
    .setDescription(truncate(game.short_description || 'No store description.', 1800))
    .addFields(
      { name: 'Price', value: price, inline: true },
      { name: 'Release', value: game.release_date?.date || 'Unknown', inline: true },
      { name: 'Platforms', value: Object.entries(game.platforms || {}).filter(([, enabled]) => enabled).map(([name]) => name).join(' • ') || 'Not listed', inline: true },
      { name: 'Developer', value: truncate(game.developers?.join(', ') || 'Not listed'), inline: true },
      { name: 'Publisher', value: truncate(game.publishers?.join(', ') || 'Not listed'), inline: true },
      { name: 'Recommendations', value: number(game.recommendations?.total), inline: true },
      { name: 'Genres', value: truncate(game.genres?.map(item => item.description).join(' • ') || 'Not listed') },
    )
    .setFooter({ text: `Steam app ${appid} • store availability and price depend on region` })
    .setTimestamp();
  if (game.header_image) embed.setImage(game.header_image);
  return embed;
}

async function achievementEmbed(input, appid) {
  const id = await steamId(input);
  const { data } = await http.get('https://api.steampowered.com/ISteamUserStats/GetPlayerAchievements/v1/', {
    params: { key: key(), steamid: id, appid, l: 'english' },
  });
  if (!data.playerstats?.success || !data.playerstats.achievements) {
    const error = new Error(data.playerstats?.error || 'Achievements are unavailable for that player and game.');
    error.friendly = true;
    throw error;
  }
  const achievements = data.playerstats.achievements;
  const unlocked = achievements.filter(item => item.achieved === 1);
  const latest = [...unlocked].sort((a, b) => b.unlocktime - a.unlocktime).slice(0, 8);
  const lines = latest.map(item => `**${item.name || item.apiname}**${item.unlocktime ? ` · ${dateTime(item.unlocktime * 1000)}` : ''}\n${truncate(item.description || 'No description.', 120)}`);
  return new EmbedBuilder()
    .setColor(colors.utility)
    .setTitle(`${data.playerstats.gameName || `App ${appid}`} achievements`)
    .setURL(`https://steamcommunity.com/profiles/${id}/stats/${appid}`)
    .setDescription(`**${unlocked.length}/${achievements.length} unlocked** (${achievements.length ? Math.round(unlocked.length / achievements.length * 100) : 0}%)`)
    .addFields({ name: 'Latest unlocks', value: truncate(lines.length ? lines.join('\n\n') : 'No unlocked achievements are public.', 4000) })
    .setFooter({ text: `Steam ID64 ${id} • public profile data only` })
    .setTimestamp();
}

module.exports = {
  data,
  async execute(interaction) {
    await interaction.deferReply({ flags: quiet(interaction) ? 64 : undefined });
    try {
      const subcommand = interaction.options.getSubcommand();
      let embed;
      if (subcommand === 'profile') embed = await profileEmbed(interaction.options.getString('user', true));
      else if (subcommand === 'game') embed = await gameEmbed(interaction.options.getInteger('appid', true));
      else embed = await achievementEmbed(interaction.options.getString('user', true), interaction.options.getInteger('appid', true));
      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      await interaction.editReply({ content: error.friendly ? error.message : apiError(error, 'Steam could not complete that request.') });
    }
  },
  steamId,
};
