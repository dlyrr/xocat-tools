// ============================================================
// /count — command usage statistics
// ------------------------------------------------------------
// The bot already logs every invocation to command_logs; this surfaces it the
// way esmBot's &count does.
// ============================================================
const { EmbedBuilder, SlashCommandBuilder } = require('discord.js');
const { colors } = require('../../../utils/constants');
const { dbAll, dbGet } = require('../../../database/db');
const { paginate } = require('../../../utils/pagination');

const PER_PAGE = 15;

module.exports = {
  prefixGreedy: 'command',
  data: new SlashCommandBuilder()
    .setName('count')
    .setDescription('See how many times each command has been used')
    .addStringOption(o => o
      .setName('command')
      .setDescription('Show the count for one command only (e.g. image, tag add)')
      .setRequired(false)
      .setMaxLength(100))
    .addStringOption(o => o
      .setName('scope')
      .setDescription('Whose usage to count (default: this server)')
      .setRequired(false)
      .addChoices(
        { name: 'This server', value: 'guild' },
        { name: 'Everywhere', value: 'global' },
        { name: 'Just me', value: 'me' },
      ))
    .addBooleanOption(o => o.setName('quiet').setDescription('Make the response only visible to you').setRequired(false)),

  prefixAliases: ['counts', 'usage'],

  async execute(interaction) {
    const quiet = interaction.options.getBoolean('quiet') ?? false;
    const requested = interaction.options.getString('command')?.trim();
    const scope = interaction.options.getString('scope') || (interaction.guildId ? 'guild' : 'global');

    const filters = [];
    const params = [];
    if (scope === 'guild') {
      if (!interaction.guildId) {
        return interaction.reply({ content: '❌ There is no server to scope to here — try `scope: Everywhere`.', flags: 64 });
      }
      filters.push('guild_id = ?');
      params.push(interaction.guildId);
    } else if (scope === 'me') {
      filters.push('user_id = ?');
      params.push(interaction.user.id);
    }

    const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
    const scopeLabel = { guild: interaction.guild?.name || 'this server', global: 'everywhere', me: 'you' }[scope];

    await interaction.deferReply({ flags: quiet ? 64 : undefined });

    if (requested) {
      // Match the command itself plus any of its subcommands.
      const needle = requested.replace(/^[/.]/, '');
      const row = dbGet(
        `SELECT COUNT(*) AS total FROM command_logs ${where}${where ? ' AND' : 'WHERE'} (
           command = ? OR command = ? OR command LIKE ? OR command LIKE ?
         )`,
        [...params, `/${needle}`, `.${needle}`, `/${needle} %`, `.${needle} %`]
      );
      const total = row?.total ?? 0;
      return interaction.editReply(
        total
          ? `\`${needle}\` has been used **${total}** time${total === 1 ? '' : 's'} (${scopeLabel}).`
          : `\`${needle}\` has not been used yet (${scopeLabel}).`
      );
    }

    // Slash and prefix invocations of the same command are counted together.
    const rows = dbAll(
      `SELECT REPLACE(REPLACE(command, '/', ''), '.', '') AS name, COUNT(*) AS total
       FROM command_logs ${where}
       GROUP BY name
       ORDER BY total DESC, name ASC`,
      params
    );

    if (!rows.length) {
      return interaction.editReply(`No commands have been recorded ${scope === 'me' ? 'for you' : `for ${scopeLabel}`} yet.`);
    }

    const grandTotal = rows.reduce((sum, row) => sum + row.total, 0);
    const pages = [];
    for (let index = 0; index < rows.length; index += PER_PAGE) {
      const slice = rows.slice(index, index + PER_PAGE);
      pages.push(new EmbedBuilder()
        .setColor(colors.utility)
        .setTitle('Command usage')
        .setDescription(slice.map((row, offset) => `**${index + offset + 1}.** \`${row.name}\` — ${row.total}`).join('\n'))
        .setFooter({ text: `${rows.length} commands · ${grandTotal} total uses · ${scopeLabel}` })
        .setTimestamp());
    }

    return paginate(interaction, pages);
  },
};
