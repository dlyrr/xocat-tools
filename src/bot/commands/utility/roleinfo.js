const { EmbedBuilder, SlashCommandBuilder } = require('discord.js');
const { colors } = require('../../../utils/constants');

module.exports = {
  prefixAliases: ['role'],
  data: new SlashCommandBuilder()
    .setName('roleinfo')
    .setDescription('Show details about a server role')
    .addRoleOption(option => option.setName('role').setDescription('Role to inspect').setRequired(true))
    .addBooleanOption(option => option.setName('quiet').setDescription('Only show the response to you')),

  async execute(interaction) {
    if (!interaction.guild) return interaction.reply({ content: 'This command can only be used in a server.', flags: 64 });
    const role = interaction.options.getRole('role', true);
    const permissions = role.permissions.toArray();
    const memberCount = interaction.guild.members.cache.filter(member => member.roles.cache.has(role.id)).size;
    const embed = new EmbedBuilder()
      .setColor(role.color || colors.utility)
      .setTitle(role.name)
      .addFields(
        { name: 'Role ID', value: `\`${role.id}\``, inline: true },
        { name: 'Color', value: `\`${role.hexColor}\``, inline: true },
        { name: 'Position', value: `${role.position} of ${interaction.guild.roles.cache.size - 1}`, inline: true },
        { name: 'Members cached', value: memberCount.toLocaleString(), inline: true },
        { name: 'Created', value: `<t:${Math.floor(role.createdTimestamp / 1000)}:F>`, inline: true },
        { name: 'Properties', value: [role.hoist && 'Displayed separately', role.mentionable && 'Mentionable', role.managed && 'Managed by an integration'].filter(Boolean).join('\n') || 'Standard role', inline: true },
        { name: `Permissions (${permissions.length})`, value: permissions.length ? permissions.slice(0, 30).map(permission => `\`${permission}\``).join(' ') : 'No permissions', inline: false }
      )
      .setFooter({ text: 'Member count reflects members currently cached by Discord' })
      .setTimestamp();
    return interaction.reply({ embeds: [embed], flags: interaction.options.getBoolean('quiet') ? 64 : undefined });
  },
};
