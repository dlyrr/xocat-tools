const { AttachmentBuilder, EmbedBuilder, SlashCommandBuilder } = require('discord.js');
const { colors } = require('../../../utils/constants');

function parseJson(text) {
  try { return { value: JSON.parse(text) }; }
  catch (error) {
    const position = Number(error.message.match(/position\s+(\d+)/i)?.[1]);
    if (!Number.isFinite(position)) return { error: error.message };
    const before = text.slice(0, position);
    const line = before.split('\n').length;
    const column = before.length - before.lastIndexOf('\n');
    return { error: `${error.message} (line ${line}, column ${column})` };
  }
}

function resultPayload(title, output, quiet, extension = 'json') {
  const embed = new EmbedBuilder().setColor(colors.utility).setTitle(title);
  if (output.length <= 3700 && !output.includes('```')) {
    embed.setDescription(`\`\`\`${extension}\n${output}\n\`\`\``);
    return { embeds: [embed], flags: quiet ? 64 : undefined };
  }
  embed.setDescription('The complete result is attached.');
  return { embeds: [embed], files: [new AttachmentBuilder(Buffer.from(output), { name: `result.${extension}` })], flags: quiet ? 64 : undefined };
}

function inspect(value) {
  const rootType = Array.isArray(value) ? 'array' : value === null ? 'null' : typeof value;
  const lines = [`Root type: ${rootType}`];
  if (Array.isArray(value)) {
    lines.push(`Items: ${value.length}`);
    const types = [...new Set(value.slice(0, 1000).map(item => Array.isArray(item) ? 'array' : item === null ? 'null' : typeof item))];
    lines.push(`Item types: ${types.join(', ') || 'none'}`);
  } else if (value && typeof value === 'object') {
    const keys = Object.keys(value);
    lines.push(`Top-level keys: ${keys.length}`);
    lines.push(keys.slice(0, 50).map(key => `${key}: ${Array.isArray(value[key]) ? `array (${value[key].length})` : value[key] === null ? 'null' : typeof value[key]}`).join('\n'));
    if (keys.length > 50) lines.push(`...and ${keys.length - 50} more keys`);
  } else {
    lines.push(`Value: ${String(value)}`);
  }
  return lines.join('\n');
}

module.exports = {
  prefixGreedy: 'input',
  prefixAliases: ['jsonfmt'],
  data: new SlashCommandBuilder()
    .setName('json')
    .setDescription('Format, validate, minify, or inspect JSON')
    .addSubcommand(sub => sub.setName('format').setDescription('Pretty-print JSON')
      .addStringOption(o => o.setName('input').setDescription('JSON text').setRequired(true).setMaxLength(4000))
      .addBooleanOption(o => o.setName('quiet').setDescription('Make the response only visible to you')))
    .addSubcommand(sub => sub.setName('minify').setDescription('Remove unnecessary whitespace from JSON')
      .addStringOption(o => o.setName('input').setDescription('JSON text').setRequired(true).setMaxLength(4000))
      .addBooleanOption(o => o.setName('quiet').setDescription('Make the response only visible to you')))
    .addSubcommand(sub => sub.setName('validate').setDescription('Validate JSON and locate syntax errors')
      .addStringOption(o => o.setName('input').setDescription('JSON text').setRequired(true).setMaxLength(4000))
      .addBooleanOption(o => o.setName('quiet').setDescription('Make the response only visible to you')))
    .addSubcommand(sub => sub.setName('inspect').setDescription('Explain the top-level structure of JSON')
      .addStringOption(o => o.setName('input').setDescription('JSON text').setRequired(true).setMaxLength(4000))
      .addBooleanOption(o => o.setName('quiet').setDescription('Make the response only visible to you'))),

  async execute(interaction) {
    const operation = interaction.options.getSubcommand();
    const quiet = interaction.options.getBoolean('quiet') ?? false;
    const parsed = parseJson(interaction.options.getString('input', true));
    if (parsed.error) return interaction.reply({ content: `Invalid JSON: ${parsed.error}`.slice(0, 1900), flags: 64 });
    if (operation === 'validate') {
      const type = Array.isArray(parsed.value) ? 'array' : parsed.value === null ? 'null' : typeof parsed.value;
      const embed = new EmbedBuilder().setColor(colors.utility).setTitle('Valid JSON').setDescription(`Parsed successfully as **${type}**.`);
      return interaction.reply({ embeds: [embed], flags: quiet ? 64 : undefined });
    }
    if (operation === 'inspect') return interaction.reply(resultPayload('JSON structure', inspect(parsed.value), quiet, 'text'));
    const output = JSON.stringify(parsed.value, null, operation === 'format' ? 2 : 0);
    return interaction.reply(resultPayload(operation === 'format' ? 'Formatted JSON' : 'Minified JSON', output, quiet));
  },

  parseJson,
  inspect,
};
