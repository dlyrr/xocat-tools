// ============================================================
// /snowflake — decode a Discord ID into a timestamp
// ============================================================
const { EmbedBuilder, SlashCommandBuilder } = require('discord.js');
const { colors } = require('../../../utils/constants');

// Discord's epoch: 2015-01-01T00:00:00Z.
const DISCORD_EPOCH = 1420070400000n;

// Anything below this predates Discord's public launch and is not a real ID.
const MIN_SNOWFLAKE = 21154535154122752n;

function parseSnowflake(input) {
  // Accept raw IDs plus every mention form: <@123>, <@!123>, <#123>, <@&123>,
  // <:name:123> and <a:name:123>.
  const cleaned = String(input ?? '')
    .trim()
    .replace(/^<a?:[\w\d_]+:(\d+)>$/, '$1')
    .replace(/[<>@#&!:]/g, '');

  if (!/^\d{15,25}$/.test(cleaned)) return null;
  const value = BigInt(cleaned);
  if (value < MIN_SNOWFLAKE) return null;
  return value;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('snowflake')
    .setDescription('Convert a Discord ID (snowflake) into the time it was created')
    .addStringOption(o => o
      .setName('id')
      .setDescription('A user, message, channel, role, or emoji ID — mentions work too')
      .setRequired(true)
      .setMaxLength(100))
    .addBooleanOption(o => o.setName('quiet').setDescription('Make the response only visible to you').setRequired(false)),

  prefixAliases: ['timestamp', 'snowstamp', 'snow'],

  async execute(interaction) {
    const quiet = interaction.options.getBoolean('quiet') ?? false;
    const raw = interaction.options.getString('id');
    const snowflake = parseSnowflake(raw);

    if (snowflake === null) {
      return interaction.reply({
        content: '❌ That is not a Discord snowflake. Pass an ID, a mention, or a custom emoji.',
        flags: 64,
      });
    }

    const milliseconds = snowflake / 4194304n + DISCORD_EPOCH;
    const seconds = milliseconds / 1000n;

    // The remaining fields are the internal bits Discord packs into every ID.
    const workerId = (snowflake >> 17n) & 0x1fn;
    const processId = (snowflake >> 12n) & 0x1fn;
    const increment = snowflake & 0xfffn;

    const embed = new EmbedBuilder()
      .setColor(colors.utility)
      .setTitle('Snowflake')
      .setDescription(`\`${snowflake}\``)
      .addFields(
        { name: 'Created', value: `<t:${seconds}:F>\n<t:${seconds}:R>`, inline: false },
        { name: 'Timestamp', value: `${milliseconds} ms`, inline: true },
        { name: 'Worker / process', value: `${workerId} / ${processId}`, inline: true },
        { name: 'Increment', value: String(increment), inline: true },
      )
      .setTimestamp();

    return interaction.reply({ embeds: [embed], flags: quiet ? 64 : undefined });
  },
};
