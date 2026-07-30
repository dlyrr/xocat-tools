const { EmbedBuilder, SlashCommandBuilder } = require('discord.js');
const { colors } = require('../../../utils/constants');

const IMPORTANT_PERMISSIONS = [
  'Administrator', 'ManageGuild', 'ManageRoles', 'ManageChannels', 'ManageMessages',
  'ModerateMembers', 'KickMembers', 'BanMembers', 'MentionEveryone', 'ManageWebhooks',
];

module.exports = {
  data: new SlashCommandBuilder()
    .setName('userinfo')
    .setDescription('Show account and server membership information')
    .addUserOption(option => option.setName('user').setDescription('User to inspect'))
    .addBooleanOption(option => option.setName('quiet').setDescription('Only show the response to you')),

  async execute(interaction) {
    const target = interaction.options.getUser('user') || interaction.user;
    const quiet = interaction.options.getBoolean('quiet') ?? false;
    await interaction.deferReply({ flags: quiet ? 64 : undefined });
    const user = await target.fetch(true).catch(() => target);
    const member = interaction.guild
      ? await interaction.guild.members.fetch(user.id).catch(() => null)
      : null;
    const badges = user.flags?.toArray() || [];
    const roles = member
      ? member.roles.cache.filter(role => role.id !== interaction.guild.id).sort((a, b) => b.position - a.position).first(12)
      : [];
    const permissions = member
      ? IMPORTANT_PERMISSIONS.filter(permission => member.permissions.has(permission))
      : [];

    const embed = new EmbedBuilder()
      .setColor(member?.displayColor || colors.utility)
      .setAuthor({ name: user.tag, iconURL: user.displayAvatarURL() })
      .setTitle(member?.displayName || user.username)
      .setThumbnail(user.displayAvatarURL({ size: 1024, forceStatic: false }))
      .addFields(
        { name: 'User ID', value: `\`${user.id}\``, inline: true },
        { name: 'Account created', value: `<t:${Math.floor(user.createdTimestamp / 1000)}:F>\n<t:${Math.floor(user.createdTimestamp / 1000)}:R>`, inline: true },
        { name: 'Badges', value: badges.length ? badges.map(badge => `\`${badge}\``).join(' ') : 'None', inline: false }
      );
    if (member) {
      embed.addFields(
        { name: 'Joined this server', value: member.joinedTimestamp ? `<t:${Math.floor(member.joinedTimestamp / 1000)}:F>\n<t:${Math.floor(member.joinedTimestamp / 1000)}:R>` : 'Unknown', inline: true },
        { name: `Roles (${Math.max(0, member.roles.cache.size - 1)})`, value: roles.length ? roles.map(role => role.toString()).join(' ') : 'None', inline: false },
        { name: 'Key permissions', value: permissions.length ? permissions.map(value => `\`${value}\``).join(' ') : 'No elevated permissions', inline: false }
      );
    }
    embed.setFooter({ text: member ? 'Account and server profile' : 'Account profile · run in a server for membership details' }).setTimestamp();
    return interaction.editReply({ embeds: [embed] });
  },
};
