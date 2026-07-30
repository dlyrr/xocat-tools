// /timer — Set a reminder
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { colors, emojis } = require('../../../utils/constants');
const { dbRun } = require('../../../database/db');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('timer')
    .setDescription('Set a timer with a reminder')
    .addStringOption(o => o.setName('duration').setDescription('Duration (e.g. 5m, 1h, 30s)').setRequired(true))
    .addStringOption(o => o.setName('message').setDescription('Reminder message').setRequired(true).setMaxLength(1000)).addBooleanOption(
    o => o.setName("quiet").setDescription("Make the response only visible to you").setRequired(false)
  ),
  async execute(interaction) {
    const quiet = interaction.options.getBoolean("quiet") ?? false;
    const durationStr = interaction.options.getString('duration');
    const message = interaction.options.getString('message');
    const ms = parseDuration(durationStr);
    if (!ms || ms < 1000 || ms > 86400000) {
      return interaction.reply({ content: 'Invalid duration. Use formats like `30s`, `5m`, `1h`. Max 24 hours.', flags: quiet ? 64 : undefined });
    }
    const remindAt = Date.now() + ms;
    dbRun('INSERT INTO timers (user_id, channel_id, guild_id, message, remind_at, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      [interaction.user.id, interaction.channelId, interaction.guildId, message, remindAt, Date.now()]);

    const embed = new EmbedBuilder()
      .setColor(colors.admin)
      .setTitle('Timer set')
      .setDescription(`I'll remind you <t:${Math.floor(remindAt / 1000)}:R>`)
      .addFields({ name: 'Message', value: message })
      .setFooter({ text: `Reminder scheduled • ${durationStr.toLowerCase()}` })
      .setTimestamp();
    await interaction.reply({
      embeds: [embed],
      flags: quiet ? 64 : undefined
    });
  },
};

function parseDuration(str) {
  const match = str.match(/^(\d+)(s|m|h|d)$/i);
  if (!match) return null;
  const [, num, unit] = match;
  const multipliers = { s: 1000, m: 60000, h: 3600000, d: 86400000 };
  return parseInt(num) * (multipliers[unit.toLowerCase()] || 0);
}

