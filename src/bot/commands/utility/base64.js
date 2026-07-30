const { AttachmentBuilder, EmbedBuilder, SlashCommandBuilder } = require('discord.js');
const { colors } = require('../../../utils/constants');

function decodeBase64(value) {
  const normalized = value.replace(/\s+/g, '');
  if (!normalized || normalized.length % 4 === 1 || !/^[A-Za-z0-9+/]*={0,2}$/.test(normalized)) throw new Error('That is not valid Base64.');
  const buffer = Buffer.from(normalized, 'base64');
  const canonicalInput = normalized.replace(/=+$/, '');
  if (buffer.toString('base64').replace(/=+$/, '') !== canonicalInput) throw new Error('That is not valid Base64.');
  const decoded = buffer.toString('utf8');
  if (decoded.includes('\uFFFD')) throw new Error('The decoded bytes are not readable UTF-8 text.');
  return decoded;
}

function responsePayload(title, output, quiet) {
  const embed = new EmbedBuilder().setColor(colors.utility).setTitle(title);
  if (output.length <= 3800 && !output.includes('```')) {
    embed.setDescription(`\`\`\`text\n${output || '(empty text)'}\n\`\`\``);
    return { embeds: [embed], flags: quiet ? 64 : undefined };
  }
  embed.setDescription('The result is attached because it is too large to display safely in an embed.');
  return { embeds: [embed], files: [new AttachmentBuilder(Buffer.from(output, 'utf8'), { name: 'base64-result.txt' })], flags: quiet ? 64 : undefined };
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('base64')
    .setDescription('Encode readable text as Base64 or decode it back to text')
    .addSubcommand(sub => sub.setName('encode').setDescription('Encode UTF-8 text as Base64')
      .addStringOption(o => o.setName('text').setDescription('Text to encode').setRequired(true).setMaxLength(4000))
      .addBooleanOption(o => o.setName('quiet').setDescription('Make the response only visible to you')))
    .addSubcommand(sub => sub.setName('decode').setDescription('Decode Base64 into readable UTF-8 text')
      .addStringOption(o => o.setName('base64').setDescription('Base64 value to decode').setRequired(true).setMaxLength(4000))
      .addBooleanOption(o => o.setName('quiet').setDescription('Make the response only visible to you'))),

  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();
    const quiet = interaction.options.getBoolean('quiet') ?? false;
    try {
      const output = subcommand === 'encode'
        ? Buffer.from(interaction.options.getString('text', true), 'utf8').toString('base64')
        : decodeBase64(interaction.options.getString('base64', true));
      return interaction.reply(responsePayload(subcommand === 'encode' ? 'Base64 encoded' : 'Base64 decoded', output, quiet));
    } catch (error) {
      return interaction.reply({ content: error.message, flags: 64 });
    }
  },

  decodeBase64,
};
