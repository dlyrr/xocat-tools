const crypto = require('crypto');
const { EmbedBuilder, SlashCommandBuilder } = require('discord.js');
const { colors } = require('../../../utils/constants');

const ALGORITHMS = ['md5', 'sha1', 'sha256', 'sha384', 'sha512'];
const choices = ALGORITHMS.map(value => ({ name: value.toUpperCase(), value }));

function digest(text, algorithm) {
  return crypto.createHash(algorithm).update(text, 'utf8').digest('hex');
}

module.exports = {
  prefixAliases: ['digest'],
  data: new SlashCommandBuilder()
    .setName('hash')
    .setDescription('Generate or verify one-way cryptographic hashes')
    .addSubcommand(sub => sub.setName('generate').setDescription('Hash text with a standard algorithm')
      .addStringOption(o => o.setName('text').setDescription('Text to hash').setRequired(true).setMaxLength(4000))
      .addStringOption(o => o.setName('algorithm').setDescription('Hash algorithm').setRequired(true).addChoices(...choices))
      .addBooleanOption(o => o.setName('quiet').setDescription('Make the response only visible to you')))
    .addSubcommand(sub => sub.setName('verify').setDescription('Check whether text matches a supplied hash')
      .addStringOption(o => o.setName('text').setDescription('Original text to check').setRequired(true).setMaxLength(4000))
      .addStringOption(o => o.setName('hash').setDescription('Expected hexadecimal hash').setRequired(true).setMaxLength(128))
      .addStringOption(o => o.setName('algorithm').setDescription('Hash algorithm').setRequired(true).addChoices(...choices))
      .addBooleanOption(o => o.setName('quiet').setDescription('Make the response only visible to you'))),

  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();
    const text = interaction.options.getString('text', true);
    const algorithm = interaction.options.getString('algorithm', true);
    const quiet = interaction.options.getBoolean('quiet') ?? false;
    const calculated = digest(text, algorithm);
    if (subcommand === 'generate') {
      const embed = new EmbedBuilder().setColor(colors.utility).setTitle(`${algorithm.toUpperCase()} hash`)
        .setDescription(`\`${calculated}\``)
        .setFooter({ text: 'Hashes are one-way and cannot be securely reversed' });
      return interaction.reply({ embeds: [embed], flags: quiet ? 64 : undefined });
    }
    const expected = interaction.options.getString('hash', true).trim().toLowerCase();
    if (!/^[\da-f]+$/.test(expected) || expected.length !== calculated.length) {
      return interaction.reply({ content: `That is not a valid ${algorithm.toUpperCase()} hexadecimal hash (${calculated.length} characters expected).`, flags: 64 });
    }
    const matches = crypto.timingSafeEqual(Buffer.from(calculated, 'hex'), Buffer.from(expected, 'hex'));
    const embed = new EmbedBuilder().setColor(matches ? colors.utility : colors.error).setTitle(matches ? 'Hash matches' : 'Hash does not match')
      .setDescription(matches ? `The supplied text produces that ${algorithm.toUpperCase()} hash.` : `The supplied text produces a different ${algorithm.toUpperCase()} hash.`)
      .setFooter({ text: 'Secure hashes cannot be reversed' });
    return interaction.reply({ embeds: [embed], flags: quiet ? 64 : undefined });
  },

  digest,
};
