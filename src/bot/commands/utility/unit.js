const { EmbedBuilder, SlashCommandBuilder } = require('discord.js');
const { colors } = require('../../../utils/constants');

const UNITS = {
  mm: { name: 'Millimeters', category: 'Length', factor: 0.001 }, cm: { name: 'Centimeters', category: 'Length', factor: 0.01 },
  m: { name: 'Meters', category: 'Length', factor: 1 }, km: { name: 'Kilometers', category: 'Length', factor: 1000 },
  in: { name: 'Inches', category: 'Length', factor: 0.0254 }, ft: { name: 'Feet', category: 'Length', factor: 0.3048 },
  yd: { name: 'Yards', category: 'Length', factor: 0.9144 }, mi: { name: 'Miles', category: 'Length', factor: 1609.344 },
  mg: { name: 'Milligrams', category: 'Mass', factor: 0.000001 }, g: { name: 'Grams', category: 'Mass', factor: 0.001 },
  kg: { name: 'Kilograms', category: 'Mass', factor: 1 }, oz: { name: 'Ounces', category: 'Mass', factor: 0.028349523125 },
  lb: { name: 'Pounds', category: 'Mass', factor: 0.45359237 }, ton: { name: 'Metric tons', category: 'Mass', factor: 1000 },
  ml: { name: 'Milliliters', category: 'Volume', factor: 0.001 }, l: { name: 'Liters', category: 'Volume', factor: 1 },
  tsp: { name: 'Teaspoons (US)', category: 'Volume', factor: 0.00492892159375 }, tbsp: { name: 'Tablespoons (US)', category: 'Volume', factor: 0.01478676478125 },
  cup: { name: 'Cups (US)', category: 'Volume', factor: 0.2365882365 }, floz: { name: 'Fluid ounces (US)', category: 'Volume', factor: 0.0295735295625 },
  gal: { name: 'Gallons (US)', category: 'Volume', factor: 3.785411784 },
  'm/s': { name: 'Meters per second', category: 'Speed', factor: 1 }, 'km/h': { name: 'Kilometers per hour', category: 'Speed', factor: 1 / 3.6 },
  mph: { name: 'Miles per hour', category: 'Speed', factor: 0.44704 }, knot: { name: 'Knots', category: 'Speed', factor: 0.5144444444 },
  b: { name: 'Bytes', category: 'Data', factor: 1 }, kb: { name: 'Kilobytes', category: 'Data', factor: 1000 },
  mb: { name: 'Megabytes', category: 'Data', factor: 1e6 }, gb: { name: 'Gigabytes', category: 'Data', factor: 1e9 },
  kib: { name: 'Kibibytes', category: 'Data', factor: 1024 }, mib: { name: 'Mebibytes', category: 'Data', factor: 1048576 }, gib: { name: 'Gibibytes', category: 'Data', factor: 1073741824 },
  c: { name: 'Celsius', category: 'Temperature' }, f: { name: 'Fahrenheit', category: 'Temperature' }, k: { name: 'Kelvin', category: 'Temperature' },
};

function convert(value, from, to) {
  const source = UNITS[from]; const target = UNITS[to];
  if (!source || !target) throw new Error('Choose units from autocomplete.');
  if (source.category !== target.category) throw new Error(`Cannot convert ${source.category.toLowerCase()} to ${target.category.toLowerCase()}.`);
  if (source.category === 'Temperature') {
    let celsius = value;
    if (from === 'f') celsius = (value - 32) * 5 / 9;
    if (from === 'k') celsius = value - 273.15;
    if (to === 'f') return celsius * 9 / 5 + 32;
    if (to === 'k') return celsius + 273.15;
    return celsius;
  }
  return value * source.factor / target.factor;
}

function formatNumber(number) {
  if (!Number.isFinite(number)) return String(number);
  const absolute = Math.abs(number);
  if ((absolute && absolute < 0.000001) || absolute >= 1e12) return number.toExponential(8).replace(/\.?0+e/, 'e');
  return new Intl.NumberFormat('en-US', { maximumSignificantDigits: 12 }).format(number);
}

module.exports = {
  prefixAliases: ['units', 'convertunit'],
  data: new SlashCommandBuilder()
    .setName('unit')
    .setDescription('Convert length, mass, temperature, volume, speed, or data units')
    .addNumberOption(o => o.setName('value').setDescription('Number to convert').setRequired(true))
    .addStringOption(o => o.setName('from').setDescription('Source unit').setRequired(true).setAutocomplete(true))
    .addStringOption(o => o.setName('to').setDescription('Destination unit').setRequired(true).setAutocomplete(true))
    .addBooleanOption(o => o.setName('quiet').setDescription('Make the response only visible to you')),

  async autocomplete(interaction) {
    const focused = interaction.options.getFocused(true);
    const query = String(focused.value || '').toLowerCase();
    let entries = Object.entries(UNITS);
    if (focused.name === 'to') {
      const from = interaction.options.getString('from');
      if (UNITS[from]) entries = entries.filter(([, unit]) => unit.category === UNITS[from].category);
    }
    await interaction.respond(entries.filter(([code, unit]) => code.includes(query) || unit.name.toLowerCase().includes(query) || unit.category.toLowerCase().includes(query))
      .slice(0, 25).map(([value, unit]) => ({ name: `${unit.name} (${value})`, value })));
  },

  async execute(interaction) {
    const value = interaction.options.getNumber('value', true);
    const from = interaction.options.getString('from', true).toLowerCase();
    const to = interaction.options.getString('to', true).toLowerCase();
    const quiet = interaction.options.getBoolean('quiet') ?? false;
    try {
      const result = convert(value, from, to);
      const embed = new EmbedBuilder().setColor(colors.utility).setTitle('Unit conversion')
        .setDescription(`## ${formatNumber(value)} ${from} = ${formatNumber(result)} ${to}`)
        .addFields({ name: 'Category', value: UNITS[from].category, inline: true }, { name: 'Precision', value: 'Up to 12 significant digits', inline: true });
      return interaction.reply({ embeds: [embed], flags: quiet ? 64 : undefined });
    } catch (error) {
      return interaction.reply({ content: error.message, flags: 64 });
    }
  },

  UNITS,
  convert,
};
