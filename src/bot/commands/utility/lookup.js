// /lookup — Cross-server user lookup (whitelisted only)
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { colors } = require('../../../utils/constants');
const { isWhitelisted } = require('../../../utils/premium');
const { paginate } = require('../../../utils/pagination');

module.exports = {
  prefixAliases: ['fetchuser'],
  data: new SlashCommandBuilder().setName('lookup').setDescription('[whitelisted only] Checks if a discord user is in any servers affiliated with the bot')
    .addUserOption(o => o.setName('user').setDescription('User to look up').setRequired(true)).addBooleanOption(
    o => o.setName("quiet").setDescription("Make the response only visible to you").setRequired(false)
  ),
  async execute(interaction) {
    const quiet = interaction.options.getBoolean("quiet") ?? false;
    if (!isWhitelisted(interaction.user.id)) return interaction.reply({ content: '❌ This command is whitelisted only.', flags: quiet ? 64 : undefined });
    await interaction.deferReply({ flags: quiet ? 64 : undefined });
    const user = interaction.options.getUser('user');
    const guilds = interaction.client.guilds.cache;
    const found = [];
    for (const [, guild] of guilds) {
      try { const member = await guild.members.fetch(user.id).catch(() => null); if (member) found.push(guild.name); } catch {}
    }
    const chunks = found.length ? chunkLines(found.map(g => `• ${g}`), 3800) : [['Not found in any affiliated servers']];
    const pages = chunks.map((lines, index) => new EmbedBuilder()
      .setColor(colors.utility)
      .setTitle(`Lookup: ${user.tag}`)
      .setDescription(lines.join('\n'))
      .setThumbnail(user.displayAvatarURL())
      .setFooter({ text: `${found.length} affiliated server${found.length === 1 ? '' : 's'} • page ${index + 1} of ${chunks.length}` })
      .setTimestamp());
    await paginate(interaction, pages);
  },
};

function chunkLines(lines, maxLength) {
  const chunks = [];
  let current = [];
  let length = 0;
  for (const line of lines) {
    const safeLine = line.length > maxLength ? `${line.slice(0, maxLength - 3)}...` : line;
    const addedLength = safeLine.length + (current.length ? 1 : 0);
    if (current.length && length + addedLength > maxLength) {
      chunks.push(current);
      current = [];
      length = 0;
    }
    current.push(safeLine);
    length += safeLine.length + (current.length > 1 ? 1 : 0);
  }
  if (current.length) chunks.push(current);
  return chunks;
}

