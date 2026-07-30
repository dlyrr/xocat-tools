// /convert — Roblox username/ID converters
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { colors } = require('../../../utils/constants');
const roblox = require('../../../services/robloxService');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('convert')
    .setDescription('Roblox username/ID converters')
    .addSubcommand(s => s.setName('robloxuser2id').setDescription('Convert a Roblox username to user ID').addStringOption(o => o.setName('username').setDescription('Roblox username').setRequired(true).setMaxLength(20)).addBooleanOption(
    o => o.setName("quiet").setDescription("Make the response only visible to you").setRequired(false)
  ))
    .addSubcommand(s => s.setName('robloxid2user').setDescription('Convert a Roblox user ID to username').addStringOption(o => o.setName('userid').setDescription('Roblox user ID').setRequired(true).setMaxLength(20)).addBooleanOption(
    o => o.setName("quiet").setDescription("Make the response only visible to you").setRequired(false)
  ))
    .addSubcommand(s => s.setName('multirobloxuser2id').setDescription('Convert multiple Roblox usernames to user IDs').addStringOption(o => o.setName('usernames').setDescription('Up to 100 comma-separated usernames').setRequired(true).setMaxLength(2000)).addBooleanOption(
    o => o.setName("quiet").setDescription("Make the response only visible to you").setRequired(false)
  )),
  async execute(interaction) {
    const quiet = interaction.options.getBoolean("quiet") ?? false;
    await interaction.deferReply({
      flags: quiet ? 64 : undefined
    });
    const sub = interaction.options.getSubcommand();
    try {
      if (sub === 'robloxuser2id') {
        const username = interaction.options.getString('username');
        const user = await roblox.getUserByUsername(username);
        if (!user) return interaction.editReply({ content: '❌ User not found.' });
        const embed = new EmbedBuilder().setColor(colors.utility).setTitle('Username → ID')
          .addFields({ name: 'Username', value: user.name, inline: true }, { name: 'User ID', value: `${user.id}`, inline: true })
          .setFooter({ text: 'Roblox • live account data' }).setTimestamp();
        await interaction.editReply({ embeds: [embed] });
      } else if (sub === 'robloxid2user') {
        const userId = interaction.options.getString('userid');
        const user = await roblox.getUserById(userId);
        const embed = new EmbedBuilder().setColor(colors.utility).setTitle('ID → Username')
          .addFields({ name: 'User ID', value: `${user.id}`, inline: true }, { name: 'Username', value: user.name, inline: true }, { name: 'Display Name', value: user.displayName, inline: true })
          .setFooter({ text: 'Roblox • live account data' }).setTimestamp();
        await interaction.editReply({ embeds: [embed] });
      } else {
        const usernames = interaction.options.getString('usernames').split(',').map(u => u.trim()).filter(Boolean);
        if (usernames.length > 100) return interaction.editReply({ content: '❌ Roblox accepts at most 100 usernames per batch.' });
        const users = await roblox.multiUsernameToId(usernames);
        const rawDescription = users.map(u => `**${u.requestedUsername || u.name}** → \`${u.id}\``).join('\n');
        const desc = clip(rawDescription, 3900);
        const embed = new EmbedBuilder().setColor(colors.utility).setTitle('Batch username → ID')
          .setDescription(desc || 'No users found')
          .setFooter({ text: `Roblox • ${users.length} result${users.length === 1 ? '' : 's'}${rawDescription.length > 3900 ? ' • truncated' : ''}` })
          .setTimestamp();
        await interaction.editReply({ embeds: [embed] });
      }
    } catch (err) { await interaction.editReply({ content: `❌ Error: ${err.message}` }); }
  },
};

function clip(value, maxLength) {
  const text = String(value ?? '');
  return text.length <= maxLength ? text : `${text.slice(0, maxLength - 3)}...`;
}

