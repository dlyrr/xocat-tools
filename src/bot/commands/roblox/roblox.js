// /roblox — Main Roblox command group
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { colors, emojis, robloxTaxRate, devexRates } = require('../../../utils/constants');
const roblox = require('../../../services/robloxService');
const { paginate } = require('../../../utils/pagination');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('roblox')
    .setDescription('Roblox utilities')
    .addSubcommand(s => s.setName('user').setDescription('Get information about a Roblox user').addStringOption(o => o.setName('username').setDescription('Roblox username').setRequired(true)).addBooleanOption(
    o => o.setName("quiet").setDescription("Make the response only visible to you").setRequired(false)
  ))
    .addSubcommand(s => s.setName('friends').setDescription("View a Roblox user's friends list").addStringOption(o => o.setName('username').setDescription('Roblox username').setRequired(true)).addBooleanOption(
    o => o.setName("quiet").setDescription("Make the response only visible to you").setRequired(false)
  ))
    .addSubcommand(s => s.setName('outfits').setDescription("Shows a Roblox user's current avatar and saved outfits").addStringOption(o => o.setName('username').setDescription('Roblox username').setRequired(true)).addBooleanOption(
    o => o.setName("quiet").setDescription("Make the response only visible to you").setRequired(false)
  ))
    .addSubcommand(s => s.setName('rap').setDescription("Check a Roblox user's RAP and limited items").addStringOption(o => o.setName('username').setDescription('Roblox username').setRequired(true)).addBooleanOption(
    o => o.setName("quiet").setDescription("Make the response only visible to you").setRequired(false)
  ))
    .addSubcommand(s => s.setName('check').setDescription('Check if a Roblox user owns a specific item').addStringOption(o => o.setName('username').setDescription('Roblox username').setRequired(true)).addStringOption(o => o.setName('assetid').setDescription('Asset ID to check').setRequired(true)).addBooleanOption(
    o => o.setName("quiet").setDescription("Make the response only visible to you").setRequired(false)
  ))
    .addSubcommand(s => s.setName('calctax').setDescription('Calculate Roblox tax and spending costs').addIntegerOption(o => o.setName('amount').setDescription('Robux amount').setRequired(true).setMinValue(1)).addBooleanOption(
    o => o.setName("quiet").setDescription("Make the response only visible to you").setRequired(false)
  ))
    .addSubcommand(s => s.setName('chat_predictor').setDescription('Predict a username\'s classic Roblox chat color').addStringOption(o => o.setName('username').setDescription('Roblox username').setRequired(true).setMinLength(3).setMaxLength(20)).addBooleanOption(
    o => o.setName("quiet").setDescription("Make the response only visible to you").setRequired(false)
  ))
    .addSubcommand(s => s.setName('devex').setDescription('Calculate the current standard Roblox DevEx rate').addIntegerOption(o => o.setName('robux').setDescription('Earned Robux amount').setRequired(true).setMinValue(1)).addBooleanOption(
    o => o.setName("quiet").setDescription("Make the response only visible to you").setRequired(false)
  ))
    .addSubcommand(s => s.setName('versions').setDescription('Check current Roblox client versions across all platforms').addBooleanOption(
    o => o.setName("quiet").setDescription("Make the response only visible to you").setRequired(false)
  ))

    .addSubcommand(s => s.setName('release_notes').setDescription('Get the latest Roblox release notes').addBooleanOption(
    o => o.setName("quiet").setDescription("Make the response only visible to you").setRequired(false)
  ))
    .addSubcommand(s => s.setName('subplace').setDescription('Browse subplace links for a Roblox game').addStringOption(o => o.setName('universeid').setDescription('Universe ID').setRequired(true).setMaxLength(30)).addBooleanOption(
    o => o.setName("quiet").setDescription("Make the response only visible to you").setRequired(false)
  )),
  async execute(interaction) {
    const quiet = interaction.options.getBoolean("quiet") ?? false;
    const sub = interaction.options.getSubcommand();
    await interaction.deferReply({
      flags: quiet ? 64 : undefined
    });
    try {
      switch (sub) {
        case 'user': return await cmdUser(interaction);
        case 'friends': return await cmdFriends(interaction);
        case 'outfits': return await cmdOutfits(interaction);
        case 'rap': return await cmdRAP(interaction);
        case 'check': return await cmdCheck(interaction);
        case 'calctax': return await cmdCalcTax(interaction);
        case 'chat_predictor': return await cmdChatPredictor(interaction);
        case 'devex': return await cmdDevEx(interaction);
        case 'versions': return await cmdVersions(interaction);

        case 'release_notes': return await cmdReleaseNotes(interaction);
        case 'subplace': return await cmdSubplace(interaction);
      }
    } catch (err) {
      await interaction.editReply({ content: `❌ Error: ${err.message}` });
    }
  },
};

async function cmdUser(interaction) {
  const username = interaction.options.getString('username');
  const user = await roblox.getUserByUsername(username);
  if (!user) return interaction.editReply({ content: '❌ User not found.' });
  const details = await roblox.getUserById(user.id);
  const thumbnail = await roblox.getUserThumbnail(user.id);
  const friendsCount = await roblox.getFriendsCount(user.id);
  const presence = await roblox.getUserPresence([user.id]);
  const presenceText = presence[0] ? ['Offline', 'Online', 'In Game', 'In Studio'][presence[0].userPresenceType] || 'Unknown' : 'Unknown';
  const created = new Date(details.created);

  const embed = new EmbedBuilder().setColor(colors.roblox).setTitle(`${emojis.roblox} ${details.displayName} (@${details.name})`)
    .setURL(`https://www.roblox.com/users/${user.id}/profile`)
    .setThumbnail(thumbnail)
    .addFields(
      { name: 'User ID', value: `${user.id}`, inline: true },
      { name: 'Status', value: presenceText, inline: true },
      { name: 'Friends', value: `${friendsCount}`, inline: true },
      { name: 'Created', value: `<t:${Math.floor(created.getTime() / 1000)}:D>`, inline: true },
      { name: 'Description', value: details.description?.slice(0, 200) || 'No description', inline: false },
    )
    .setTimestamp();
  if (details.isBanned) {
    embed.setFooter({ text: 'This account is banned' });
  }
  await interaction.editReply({ embeds: [embed] });
}

async function cmdFriends(interaction) {
  const username = interaction.options.getString('username');
  const user = await roblox.getUserByUsername(username);
  if (!user) return interaction.editReply({ content: '❌ User not found.' });
  const friends = await roblox.getUserFriends(user.id);
  if (!friends.length) return interaction.editReply({ content: 'This user has no friends.' });

  const pages = [];
  for (let i = 0; i < friends.length; i += 10) {
    const chunk = friends.slice(i, i + 10);
    const desc = chunk.map((f, idx) => `**${i + idx + 1}.** [${f.displayName}](https://www.roblox.com/users/${f.id}/profile) (@${f.name})`).join('\n');
    pages.push(new EmbedBuilder().setColor(colors.roblox).setTitle(`${user.name}'s friends (${friends.length})`).setDescription(desc).setTimestamp());
  }
  await paginate(interaction, pages);
}

async function cmdOutfits(interaction) {
  const username = interaction.options.getString('username');
  const user = await roblox.getUserByUsername(username);
  if (!user) return interaction.editReply({ content: '❌ User not found.' });
  const { outfits, total } = await roblox.getUserOutfits(user.id);
  const avatar = await roblox.getUserFullBody(user.id);

  const embed = new EmbedBuilder().setColor(colors.roblox).setTitle(`${user.name}'s avatar and outfits`)
    .setThumbnail(avatar)
    .setDescription(outfits.length ? outfits.slice(0, 15).map((o, i) => `**${i + 1}.** ${o.name}`).join('\n') : 'No saved outfits')
    .setFooter({ text: `Showing ${Math.min(outfits.length, 15)} of ${total} saved outfits` }).setTimestamp();
  await interaction.editReply({ embeds: [embed] });
}

async function cmdRAP(interaction) {
  const username = interaction.options.getString('username');
  const user = await roblox.getUserByUsername(username);
  if (!user) return interaction.editReply({ content: '❌ User not found.' });
  const items = await roblox.getUserCollectibles(user.id);
  const totalRAP = items.reduce((sum, i) => sum + (i.recentAveragePrice || 0), 0);
  const thumbnail = await roblox.getUserThumbnail(user.id);
  const topItems = items.sort((a, b) => (b.recentAveragePrice || 0) - (a.recentAveragePrice || 0)).slice(0, 10);

  const embed = new EmbedBuilder().setColor(colors.roblox)
    .setTitle(`${user.name}'s RAP`)
    .setThumbnail(thumbnail)
    .addFields(
      { name: 'Total RAP', value: `R$ ${totalRAP.toLocaleString()}`, inline: true },
      { name: 'Total items', value: `${items.length}`, inline: true },
    )
    .setDescription(topItems.length ? topItems.map((i, idx) => `**${idx + 1}.** ${i.name} — R$ ${(i.recentAveragePrice || 0).toLocaleString()}`).join('\n') : 'No limited items found')
    .setTimestamp();
  await interaction.editReply({ embeds: [embed] });
}

async function cmdCheck(interaction) {
  const username = interaction.options.getString('username');
  const assetId = interaction.options.getString('assetid');
  const user = await roblox.getUserByUsername(username);
  if (!user) return interaction.editReply({ content: '❌ User not found.' });
  const owns = await roblox.userOwnsAsset(user.id, assetId);
  const embed = new EmbedBuilder().setColor(owns ? colors.roblox : colors.error)
    .setTitle('Ownership check')
    .setDescription(`**${user.name}** ${owns ? 'owns' : 'does not own'} asset \`${assetId}\``)
    .setTimestamp();
  await interaction.editReply({ embeds: [embed] });
}

async function cmdCalcTax(interaction) {
  const amount = interaction.options.getInteger('amount');
  const afterTax = Math.floor(amount * (1 - robloxTaxRate));
  const beforeTax = Math.ceil(amount / (1 - robloxTaxRate));
  const embed = new EmbedBuilder().setColor(colors.roblox).setTitle('Roblox tax calculator')
    .addFields(
      { name: 'If you sell for', value: `R$ ${amount.toLocaleString()}`, inline: true },
      { name: 'You receive', value: `R$ ${afterTax.toLocaleString()}`, inline: true },
      { name: 'Tax (30%)', value: `R$ ${(amount - afterTax).toLocaleString()}`, inline: true },
      { name: 'To receive this amount', value: `Price needed: R$ ${beforeTax.toLocaleString()}`, inline: false },
    ).setTimestamp();
  await interaction.editReply({ embeds: [embed] });
}

async function cmdDevEx(interaction) {
  const robux = interaction.options.getInteger('robux');
  const usd = (robux * devexRates.rate).toFixed(2);
  const embed = new EmbedBuilder().setColor(colors.roblox).setTitle('DevEx calculator')
    .addFields(
      { name: 'Robux', value: `R$ ${robux.toLocaleString()}`, inline: true },
      { name: 'USD', value: `$${usd}`, inline: true },
      { name: 'Rate', value: `$${devexRates.rate} per R$`, inline: true },
      { name: 'Minimum', value: `R$ ${devexRates.minCashout.toLocaleString()} required`, inline: false },
    ).setTimestamp();
  await interaction.editReply({ embeds: [embed] });
}

async function cmdVersions(interaction) {
  const axios = require('axios');
  try {
    const response = await axios.get('https://weao.xyz/api/versions/current', {
      headers: { 'User-Agent': 'WEAO-3PService' }
    });
    const data = response.data;
    
    const embed = new EmbedBuilder()
      .setColor(colors.roblox)
      .setTitle('Roblox Client Versions')
      .setThumbnail('https://weao.xyz/logo.png')
      .addFields(
      { name: 'Windows', value: `\`\`${data.Windows || 'N/A'}\`\`\nUpdated: ${data.WindowsDate || 'Unknown'}`, inline: true },
      { name: 'macOS', value: `\`\`${data.Mac || 'N/A'}\`\`\nUpdated: ${data.MacDate || 'Unknown'}`, inline: true },
      { name: 'Android', value: `\`\`${data.Android || 'N/A'}\`\`\nUpdated: ${data.AndroidDate || 'Unknown'}`, inline: true },
      { name: 'iOS', value: `\`\`${data.iOS || 'N/A'}\`\`\nUpdated: ${data.iOSDate || 'Unknown'}`, inline: true }
      )
      .setFooter({ 
        text: 'Powered by weao.xyz',
        iconURL: 'https://cdn.discordapp.com/emojis/1502955460163010561.png'
      })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  } catch (err) {
    console.error('[ROBLOX] WEAO Version Error:', err.message);
    await interaction.editReply({ content: '❌ Failed to fetch versions from WEAO API.' });
  }
}
async function cmdReleaseNotes(interaction) {
  const notes = await roblox.getReleaseNotes();
  if (!notes.length) return interaction.editReply({ content: 'Could not fetch release notes.' });
  const desc = notes.map(n => `• [${n.title}](https://devforum.roblox.com/t/${n.slug}/${n.id})`).join('\n');
  const embed = new EmbedBuilder().setColor(colors.roblox).setTitle('Latest Roblox release notes').setDescription(desc).setTimestamp();
  await interaction.editReply({ embeds: [embed] });
}

async function cmdSubplace(interaction) {
  const universeId = interaction.options.getString('universeid');
  if (!/^\d+$/.test(universeId)) return interaction.editReply({ content: '❌ Universe ID must contain only numbers.' });
  const { places, truncated } = await roblox.getSubplaces(universeId);
  if (!places.length) {
    return interaction.editReply({ embeds: [new EmbedBuilder().setColor(colors.roblox).setTitle('Subplaces').setDescription('No subplaces found.').setTimestamp()] });
  }

  const pages = [];
  for (let index = 0; index < places.length; index += 10) {
    const chunk = places.slice(index, index + 10);
    pages.push(new EmbedBuilder()
      .setColor(colors.roblox)
    .setTitle(`Subplaces (${places.length}${truncated ? '+' : ''})`)
      .setDescription(chunk.map((place, offset) => {
        const name = String(place.name || `Place ${place.id}`).slice(0, 100).replace(/([\\`*_{}[\]()#+\-.!|>])/g, '\\$1');
        return `**${index + offset + 1}.** ${name} — [Play](https://www.roblox.com/games/${place.id})`;
      }).join('\n'))
      .setFooter({ text: truncated ? 'Showing the first 2,000 subplaces' : `Universe ${universeId}` })
      .setTimestamp());
  }
  await paginate(interaction, pages);
}

async function cmdChatPredictor(interaction) {
  const username = interaction.options.getString('username');
  const user = await roblox.getUserByUsername(username);
  if (!user) return interaction.editReply({ content: '❌ User not found.' });

  const [color, thumbnail] = await Promise.all([
    Promise.resolve(roblox.predictChatColor(user.name)),
    roblox.getUserThumbnail(user.id),
  ]);
  const embed = new EmbedBuilder()
    .setColor(Number.parseInt(color.hex.slice(1), 16))
    .setTitle(`${user.name}'s Classic Chat Color`)
    .setURL(`https://www.roblox.com/users/${user.id}/profile`)
    .setDescription(`**${color.name}**\n\`${color.hex}\` · \`rgb(${color.rgb.join(', ')})\``)
    .setFooter({ text: 'Classic/default chat only • experiences can override name colors' });
  if (thumbnail) embed.setThumbnail(thumbnail);

  await interaction.editReply({ embeds: [embed] });
}

