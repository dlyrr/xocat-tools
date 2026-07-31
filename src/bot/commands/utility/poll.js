const { PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');
const { dbGet, dbRun } = require('../../../database/db');
const { pollPayload } = require('../../../services/pollService');

function parseDuration(value) {
  if (!value) return null;
  const match = String(value).trim().match(/^(\d+)(m|h|d|w)$/i);
  if (!match) return NaN;
  return Number(match[1]) * { m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000 }[match[2].toLowerCase()];
}

module.exports = {
  prefixAliases: ['vote'],
  data: new SlashCommandBuilder()
    .setName('poll')
    .setDescription('Create a button poll with multiple choices')
    .addStringOption(option => option.setName('question').setDescription('Poll question').setRequired(true).setMaxLength(256))
    .addStringOption(option => option.setName('choices').setDescription('2–10 choices separated by |').setRequired(true).setMaxLength(1000))
    .addStringOption(option => option.setName('duration').setDescription('Optional expiration, such as 30m, 2h, 3d, or 1w').setMaxLength(20))
    .addBooleanOption(option => option.setName('multiple').setDescription('Allow each person to select multiple choices'))
    .addBooleanOption(option => option.setName('anonymous').setDescription('Label the poll as anonymous'))
    .setDefaultMemberPermissions(PermissionFlagsBits.SendMessages),

  async execute(interaction) {
    const choices = interaction.options.getString('choices', true)
      .split('|')
      .map(choice => choice.trim())
      .filter(Boolean);
    if (choices.length < 2 || choices.length > 10 || choices.some(choice => choice.length > 80)) {
      return interaction.reply({ content: 'Provide 2–10 choices separated by `|`; each choice can be up to 80 characters.', flags: 64 });
    }
    const duration = parseDuration(interaction.options.getString('duration'));
    if (Number.isNaN(duration) || (duration && (duration < 60_000 || duration > 30 * 86_400_000))) {
      return interaction.reply({ content: 'Duration must be from 1 minute to 30 days, such as `30m`, `2h`, `3d`, or `1w`.', flags: 64 });
    }

    await interaction.deferReply();
    dbRun(
      'INSERT INTO polls (guild_id, channel_id, creator_id, question, choices_json, multiple, anonymous, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [
        interaction.guildId,
        interaction.channelId,
        interaction.user.id,
        interaction.options.getString('question', true),
        JSON.stringify(choices),
        interaction.options.getBoolean('multiple') ? 1 : 0,
        interaction.options.getBoolean('anonymous') ? 1 : 0,
        duration ? Date.now() + duration : null,
        Date.now(),
      ]
    );
    const poll = dbGet('SELECT * FROM polls WHERE creator_id = ? ORDER BY id DESC LIMIT 1', [interaction.user.id]);
    poll.choices = choices;
    const message = await interaction.editReply(pollPayload(poll));
    dbRun('UPDATE polls SET message_id = ? WHERE id = ?', [message.id, poll.id]);
  },

  parseDuration,
};
