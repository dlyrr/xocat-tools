// /exchange — Currency converter
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { colors } = require('../../../utils/constants');
const { convertCurrency } = require('../../../services/cryptoService');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('exchange')
    .setDescription('Convert between supported fiat currencies')
    .addNumberOption(o => o.setName('amount').setDescription('Amount to convert').setRequired(true).setMinValue(0.01))
    .addStringOption(o => o.setName('from').setDescription('From currency (e.g. USD)').setRequired(true))
    .addStringOption(o => o.setName('to').setDescription('To currency (e.g. EUR)').setRequired(true)).addBooleanOption(
    o => o.setName("quiet").setDescription("Make the response only visible to you").setRequired(false)
  ),
  async execute(interaction) {
    const quiet = interaction.options.getBoolean("quiet") ?? false;
    await interaction.deferReply({
      flags: quiet ? 64 : undefined
    });
    try {
      const amount = interaction.options.getNumber('amount');
      const from = interaction.options.getString('from').toUpperCase();
      const to = interaction.options.getString('to').toUpperCase();
      if (!/^[A-Z]{3}$/.test(from) || !/^[A-Z]{3}$/.test(to)) {
      return interaction.editReply({ content: 'Currency codes must use three letters, such as `USD` or `EUR`.' });
      }
      const result = await convertCurrency(amount, from, to);
      const embed = new EmbedBuilder().setColor(colors.finance)
      .setTitle('Currency exchange')
        .addFields(
          { name: 'From', value: `${amount.toLocaleString()} ${from}`, inline: true },
          { name: 'To', value: `${result.result.toLocaleString()} ${to}`, inline: true },
          { name: 'Rate', value: `1 ${from} = ${result.rate} ${to}`, inline: false },
        )
        .setFooter({ text: 'ExchangeRate-API • live conversion rate' })
        .setTimestamp();
      await interaction.editReply({ embeds: [embed] });
    } catch (err) {
    await interaction.editReply({ content: `Error: ${err.message}` });
    }
  },
};

