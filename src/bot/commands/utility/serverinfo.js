const { ChannelType, EmbedBuilder, SlashCommandBuilder } = require('discord.js');
const { colors } = require('../../../utils/constants');

module.exports = {
  prefixAliases: ['guildinfo', 'server'],
  data: new SlashCommandBuilder()
    .setName('serverinfo')
    .setDescription('Show information and statistics for this server')
    .addBooleanOption(option => option.setName('quiet').setDescription('Only show the response to you')),

  async execute(interaction) {
    if (!interaction.guild) return interaction.reply({ content: 'This command can only be used in a server.', flags: 64 });
    const quiet = interaction.options.getBoolean('quiet') ?? false;
    await interaction.deferReply({ flags: quiet ? 64 : undefined });
    const guild = interaction.guild;
    const owner = await guild.fetchOwner().catch(() => null);
    const channels = guild.channels.cache;
    const textCount = channels.filter(channel => [ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildForum].includes(channel.type)).size;
    const voiceCount = channels.filter(channel => [ChannelType.GuildVoice, ChannelType.GuildStageVoice].includes(channel.type)).size;
    const icon = guild.iconURL({ size: 1024, forceStatic: false });
    const embed = new EmbedBuilder()
      .setColor(colors.primary)
      .setTitle(guild.name)
      .setThumbnail(icon)
      .addFields(
        { name: 'Owner', value: owner ? `${owner}\n\`${owner.id}\`` : `\`${guild.ownerId}\``, inline: true },
        { name: 'Created', value: `<t:${Math.floor(guild.createdTimestamp / 1000)}:F>\n<t:${Math.floor(guild.createdTimestamp / 1000)}:R>`, inline: true },
        { name: 'Members', value: guild.memberCount.toLocaleString(), inline: true },
        { name: 'Boosts', value: `${guild.premiumSubscriptionCount || 0} · Tier ${guild.premiumTier}`, inline: true },
        { name: 'Channels', value: `${textCount} text · ${voiceCount} voice · ${channels.size} total`, inline: true },
        { name: 'Roles', value: `${Math.max(0, guild.roles.cache.size - 1)}`, inline: true },
        { name: 'Verification', value: `\`${String(guild.verificationLevel)}\``, inline: true },
        { name: 'Server ID', value: `\`${guild.id}\``, inline: true }
      )
      .setFooter({ text: guild.description || `${guild.features.length} enabled server features` })
      .setTimestamp();
    if (guild.bannerURL()) embed.setImage(guild.bannerURL({ size: 1024 }));
    return interaction.editReply({ embeds: [embed] });
  },
};
