// /about — Bot info
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { colors, emojis } = require('../../../utils/constants');
const { dbGet } = require('../../../database/db');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('about')
    .setDescription('About the bot').addBooleanOption(
    o => o.setName("quiet").setDescription("Make the response only visible to you").setRequired(false)
  ),
  async execute(interaction) {
    const quiet = interaction.options.getBoolean("quiet") ?? false;
    const totalCmds = dbGet('SELECT COUNT(*) as c FROM command_logs') || { c: 0 };
    const totalUsers = dbGet('SELECT COUNT(*) as c FROM user_profiles') || { c: 0 };
    const uptime = process.uptime();
    const h = Math.floor(uptime / 3600);
    const m = Math.floor((uptime % 3600) / 60);
    const s = Math.floor(uptime % 60);

    const embed = new EmbedBuilder()
      .setColor(colors.primary)
      .setTitle('Discord Multi-Bot')
      .setDescription(`A feature-rich Discord bot with **${interaction.client.commands.size} maintained slash commands**.`)
      .addFields(
        { name: 'Stats', value: `**Servers:** ${interaction.client.guilds.cache.size}\n**Known Profiles:** ${totalUsers.c}\n**Commands:** ${interaction.client.commands.size}`, inline: true },
        { name: 'Uptime', value: `${h}h ${m}m ${s}s`, inline: true },
        { name: 'Usage', value: `**Total Commands Run:** ${totalCmds.c}\n**Unique Users:** ${totalUsers.c}`, inline: true },
        { name: 'Categories', value: '`AI` `Roblox` `Games` `Fun` `Social Media` `Finance` `Admin` `Utility`', inline: false },
      )
      .setFooter({ text: `Requested by ${interaction.user.tag}`, iconURL: interaction.user.displayAvatarURL() })
      .setTimestamp();
    await interaction.reply({
      embeds: [embed],
      flags: quiet ? 64 : undefined
    });
  },
};

