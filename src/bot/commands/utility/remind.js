const { EmbedBuilder, SlashCommandBuilder } = require('discord.js');
const { dbAll, dbRun } = require('../../../database/db');
const { colors } = require('../../../utils/constants');

const MAX_REMINDER_MS = 365 * 24 * 60 * 60 * 1000;

function parseWhen(input, now = Date.now()) {
  const value = String(input || '').trim();
  const timestamp = value.match(/^<t:(\d{10,13})(?::[tTdDfFR])?>$/i);
  if (timestamp) {
    const raw = Number(timestamp[1]);
    return raw < 10_000_000_000 ? raw * 1000 : raw;
  }

  const relative = value.match(/^in\s+(\d+)\s*(seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h|days?|d|weeks?|w)$/i);
  if (relative) {
    const amount = Number(relative[1]);
    const unit = relative[2].toLowerCase()[0];
    const multiplier = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000 }[unit];
    return now + amount * multiplier;
  }

  const tomorrow = value.match(/^tomorrow(?:\s+at)?\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i);
  if (tomorrow) {
    let hour = Number(tomorrow[1]);
    const minute = Number(tomorrow[2] || 0);
    const meridiem = tomorrow[3]?.toLowerCase();
    if (meridiem === 'pm' && hour < 12) hour += 12;
    if (meridiem === 'am' && hour === 12) hour = 0;
    const date = new Date(now);
    date.setDate(date.getDate() + 1);
    date.setHours(hour, minute, 0, 0);
    return date.getTime();
  }

  const normalized = /^\d{4}-\d{2}-\d{2}\s+\d{1,2}:\d{2}$/.test(value)
    ? value.replace(' ', 'T')
    : value;
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('remind')
    .setDescription('Create and manage long-term reminders')
    .addSubcommand(subcommand => subcommand
      .setName('set')
      .setDescription('Schedule a reminder for a time or date')
      .addStringOption(option => option.setName('when').setDescription('Example: in 2 days, tomorrow 5pm, 2026-08-01T15:00-05:00').setRequired(true).setMaxLength(100))
      .addStringOption(option => option.setName('message').setDescription('What should I remind you about?').setRequired(true).setMaxLength(1000))
      .addBooleanOption(option => option.setName('quiet').setDescription('Only show the confirmation to you')))
    .addSubcommand(subcommand => subcommand
      .setName('list')
      .setDescription('List your upcoming reminders')
      .addBooleanOption(option => option.setName('quiet').setDescription('Only show the list to you')))
    .addSubcommand(subcommand => subcommand
      .setName('cancel')
      .setDescription('Cancel one of your reminders')
      .addIntegerOption(option => option.setName('id').setDescription('Reminder ID from /remind list').setRequired(true).setMinValue(1))
      .addBooleanOption(option => option.setName('quiet').setDescription('Only show the confirmation to you'))),

  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();
    const quiet = interaction.options.getBoolean('quiet') ?? true;

    if (subcommand === 'set') {
      const remindAt = parseWhen(interaction.options.getString('when', true));
      const message = interaction.options.getString('message', true).trim();
      const delay = remindAt - Date.now();
      if (!remindAt || delay < 10_000 || delay > MAX_REMINDER_MS) {
        return interaction.reply({
          content: 'Use a future time between 10 seconds and one year. Examples: `in 2 days`, `tomorrow 5pm`, or `2026-08-01T15:00-05:00`.',
          flags: 64,
        });
      }

      dbRun(
        'INSERT INTO timers (user_id, channel_id, guild_id, message, remind_at, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        [interaction.user.id, interaction.channelId, interaction.guildId, message, remindAt, Date.now()]
      );
      const reminder = dbAll('SELECT id FROM timers WHERE user_id = ? ORDER BY id DESC LIMIT 1', [interaction.user.id])[0];
      const embed = new EmbedBuilder()
        .setColor(colors.utility)
        .setTitle('Reminder scheduled')
        .setDescription(message)
        .addFields(
          { name: 'When', value: `<t:${Math.floor(remindAt / 1000)}:F>\n<t:${Math.floor(remindAt / 1000)}:R>`, inline: true },
          { name: 'Reminder ID', value: `\`${reminder?.id || '—'}\``, inline: true }
        )
        .setFooter({ text: 'Times without an offset use the bot host timezone' })
        .setTimestamp();
      return interaction.reply({ embeds: [embed], flags: quiet ? 64 : undefined });
    }

    if (subcommand === 'list') {
      const reminders = dbAll(
        'SELECT id, message, remind_at FROM timers WHERE user_id = ? AND remind_at > ? ORDER BY remind_at ASC LIMIT 20',
        [interaction.user.id, Date.now()]
      );
      const description = reminders.length
        ? reminders.map(row => `\`#${row.id}\` <t:${Math.floor(row.remind_at / 1000)}:R> — ${String(row.message).slice(0, 140)}`).join('\n')
        : 'You do not have any upcoming reminders.';
      return interaction.reply({
        embeds: [new EmbedBuilder().setColor(colors.utility).setTitle('Your reminders').setDescription(description).setFooter({ text: `${reminders.length} shown` })],
        flags: quiet ? 64 : undefined,
      });
    }

    const id = interaction.options.getInteger('id', true);
    const result = dbRun('DELETE FROM timers WHERE id = ? AND user_id = ?', [id, interaction.user.id]);
    return interaction.reply({
      content: result.changes ? `Reminder \`#${id}\` was cancelled.` : `I could not find reminder \`#${id}\` in your reminders.`,
      flags: quiet ? 64 : undefined,
    });
  },

  parseWhen,
};
