const { EmbedBuilder, SlashCommandBuilder } = require('discord.js');
const { colors } = require('../../../utils/constants');

const ZONES = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : ['UTC'];
const ALIASES = new Map([
  ['utc', 'UTC'], ['gmt', 'UTC'], ['chicago', 'America/Chicago'], ['central', 'America/Chicago'],
  ['new york', 'America/New_York'], ['eastern', 'America/New_York'], ['denver', 'America/Denver'],
  ['mountain', 'America/Denver'], ['los angeles', 'America/Los_Angeles'], ['pacific', 'America/Los_Angeles'],
  ['london', 'Europe/London'], ['paris', 'Europe/Paris'], ['berlin', 'Europe/Berlin'], ['tokyo', 'Asia/Tokyo'],
  ['seoul', 'Asia/Seoul'], ['sydney', 'Australia/Sydney'], ['india', 'Asia/Calcutta'], ['dubai', 'Asia/Dubai'],
]);

function resolveZone(input) {
  const value = input.trim();
  const alias = ALIASES.get(value.toLowerCase());
  if (alias) return alias;
  const exact = ZONES.find(zone => zone.toLowerCase() === value.toLowerCase());
  if (exact) return exact;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format();
    return value;
  } catch { return null; }
}

function zonedParts(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(date);
  return Object.fromEntries(parts.filter(p => p.type !== 'literal').map(p => [p.type, Number(p.value)]));
}

function parseZoned(dateText, timeText, timeZone) {
  const dateMatch = dateText.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const timeMatch = timeText.match(/^(\d{1,2}):(\d{2})$/);
  if (!dateMatch || !timeMatch) throw new Error('Use `YYYY-MM-DD` for the date and `HH:mm` for the time.');
  const wanted = { year: +dateMatch[1], month: +dateMatch[2], day: +dateMatch[3], hour: +timeMatch[1], minute: +timeMatch[2], second: 0 };
  if (wanted.hour > 23 || wanted.minute > 59 || wanted.month < 1 || wanted.month > 12 || wanted.day < 1 || wanted.day > 31) throw new Error('That date or time is not valid.');
  const wallClockUtc = Date.UTC(wanted.year, wanted.month - 1, wanted.day, wanted.hour, wanted.minute);
  let candidate = wallClockUtc;
  for (let i = 0; i < 3; i++) {
    const actual = zonedParts(new Date(candidate), timeZone);
    const representedUtc = Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute, actual.second);
    candidate += wallClockUtc - representedUtc;
  }
  const check = zonedParts(new Date(candidate), timeZone);
  if (['year', 'month', 'day', 'hour', 'minute'].some(key => check[key] !== wanted[key])) {
    throw new Error('That local time does not exist in this timezone, likely because of daylight-saving time.');
  }
  return new Date(candidate);
}

function formatInZone(date, zone) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: zone, dateStyle: 'full', timeStyle: 'long', hour12: true,
  }).format(date);
}

function currentDateInZone(zone) {
  const p = zonedParts(new Date(), zone);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

module.exports = {
  prefixGreedy: 'location',
  prefixAliases: ['tz', 'time'],
  data: new SlashCommandBuilder()
    .setName('timezone')
    .setDescription('Show current time or convert between timezones')
    .addSubcommand(sub => sub.setName('now').setDescription('Show the current time in another timezone')
      .addStringOption(o => o.setName('location').setDescription('IANA timezone or city, such as America/Chicago').setRequired(true).setAutocomplete(true))
      .addBooleanOption(o => o.setName('quiet').setDescription('Make the response only visible to you')))
    .addSubcommand(sub => sub.setName('convert').setDescription('Convert a local date and time between timezones')
      .addStringOption(o => o.setName('time').setDescription('24-hour time in HH:mm format').setRequired(true).setMaxLength(5))
      .addStringOption(o => o.setName('from').setDescription('Source timezone').setRequired(true).setAutocomplete(true))
      .addStringOption(o => o.setName('to').setDescription('Destination timezone').setRequired(true).setAutocomplete(true))
      .addStringOption(o => o.setName('date').setDescription('Date as YYYY-MM-DD; defaults to today in the source timezone').setMaxLength(10))
      .addBooleanOption(o => o.setName('quiet').setDescription('Make the response only visible to you'))),

  async autocomplete(interaction) {
    const query = String(interaction.options.getFocused() || '').toLowerCase().replace(/\s+/g, '_');
    const aliasChoices = [...ALIASES].map(([name, value]) => ({ name: `${name} — ${value}`, value }));
    const choices = [...aliasChoices, ...ZONES.map(value => ({ name: value.replace(/_/g, ' '), value }))]
      .filter(item => !query || item.name.toLowerCase().replace(/\s+/g, '_').includes(query) || item.value.toLowerCase().includes(query))
      .filter((item, index, array) => array.findIndex(other => other.value === item.value) === index)
      .slice(0, 25);
    await interaction.respond(choices);
  },

  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();
    const quiet = interaction.options.getBoolean('quiet') ?? false;
    if (subcommand === 'now') {
      const zone = resolveZone(interaction.options.getString('location', true));
      if (!zone) return interaction.reply({ content: 'Choose a valid IANA timezone from autocomplete.', flags: 64 });
      const now = new Date();
      const embed = new EmbedBuilder().setColor(colors.utility).setTitle(zone.replace(/_/g, ' '))
        .setDescription(`## ${formatInZone(now, zone)}\n<t:${Math.floor(now.getTime() / 1000)}:R>`)
        .setFooter({ text: `IANA timezone: ${zone}` });
      return interaction.reply({ embeds: [embed], flags: quiet ? 64 : undefined });
    }
    const from = resolveZone(interaction.options.getString('from', true));
    const to = resolveZone(interaction.options.getString('to', true));
    if (!from || !to) return interaction.reply({ content: 'Choose valid source and destination timezones from autocomplete.', flags: 64 });
    try {
      const dateText = interaction.options.getString('date') || currentDateInZone(from);
      const instant = parseZoned(dateText, interaction.options.getString('time', true), from);
      const embed = new EmbedBuilder().setColor(colors.utility).setTitle('Timezone conversion')
        .addFields(
          { name: from.replace(/_/g, ' '), value: formatInZone(instant, from) },
          { name: to.replace(/_/g, ' '), value: formatInZone(instant, to) },
        )
        .setDescription(`Same moment: <t:${Math.floor(instant.getTime() / 1000)}:F>`)
        .setFooter({ text: 'Daylight-saving offsets are applied automatically' });
      return interaction.reply({ embeds: [embed], flags: quiet ? 64 : undefined });
    } catch (error) {
      return interaction.reply({ content: error.message, flags: 64 });
    }
  },

  resolveZone,
  parseZoned,
};
