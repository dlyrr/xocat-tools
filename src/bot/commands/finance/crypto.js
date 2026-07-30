// /crypto — Cryptocurrency commands
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { emojis, cryptoChains } = require('../../../utils/constants');
const crypto = require('../../../services/cryptoService');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('crypto')
    .setDescription('Cryptocurrency commands')
    .addSubcommandGroup(g => g.setName('bitcoin').setDescription('Bitcoin commands')
      .addSubcommand(s => s.setName('price').setDescription('Show the current Bitcoin (BTC) market price').addBooleanOption(
    o => o.setName("quiet").setDescription("Make the response only visible to you").setRequired(false)
  ))
      .addSubcommand(s => s.setName('address').setDescription('Shows Bitcoin address balance').addStringOption(o => o.setName('address').setDescription('BTC address').setRequired(true)).addBooleanOption(
    o => o.setName("quiet").setDescription("Make the response only visible to you").setRequired(false)
  )))
    .addSubcommandGroup(g => g.setName('ethereum').setDescription('Ethereum commands')
      .addSubcommand(s => s.setName('price').setDescription('Show the current Ethereum (ETH) market price').addBooleanOption(
    o => o.setName("quiet").setDescription("Make the response only visible to you").setRequired(false)
  ))
      .addSubcommand(s => s.setName('address').setDescription('Shows Ethereum address balance').addStringOption(o => o.setName('address').setDescription('ETH address').setRequired(true)).addBooleanOption(
    o => o.setName("quiet").setDescription("Make the response only visible to you").setRequired(false)
  )))
    .addSubcommandGroup(g => g.setName('solana').setDescription('Solana commands')
      .addSubcommand(s => s.setName('price').setDescription('Show the current Solana (SOL) market price').addBooleanOption(
    o => o.setName("quiet").setDescription("Make the response only visible to you").setRequired(false)
  ))
      .addSubcommand(s => s.setName('address').setDescription('Shows Solana address balance').addStringOption(o => o.setName('address').setDescription('SOL address').setRequired(true)).addBooleanOption(
    o => o.setName("quiet").setDescription("Make the response only visible to you").setRequired(false)
  )))
    .addSubcommandGroup(g => g.setName('litecoin').setDescription('Litecoin commands')
      .addSubcommand(s => s.setName('price').setDescription('Show the current Litecoin (LTC) market price').addBooleanOption(
    o => o.setName("quiet").setDescription("Make the response only visible to you").setRequired(false)
  ))
      .addSubcommand(s => s.setName('address').setDescription('Shows Litecoin address balance').addStringOption(o => o.setName('address').setDescription('LTC address').setRequired(true)).addBooleanOption(
    o => o.setName("quiet").setDescription("Make the response only visible to you").setRequired(false)
  ))),
  async execute(interaction) {
    const quiet = interaction.options.getBoolean("quiet") ?? false;
    await interaction.deferReply({
      flags: quiet ? 64 : undefined
    });
    const group = interaction.options.getSubcommandGroup(false);
    const sub = interaction.options.getSubcommand();

    try {
      if (group) {
        const chain = cryptoChains[group];
        if (sub === 'price') {
          const price = await crypto.getCryptoPrice(chain.coingeckoId);
      if (!price) return interaction.editReply({ content: 'Could not fetch price data.' });
          const change24h = price.price_change_percentage_24h;
          const changeEmoji = change24h >= 0 ? emojis.chart_up : emojis.chart_down;
          const embed = new EmbedBuilder().setColor(chain.color)
            .setTitle(`${changeEmoji} ${chain.name} (${chain.symbol})`)
            .setThumbnail(price.image)
            .addFields(
          { name: 'Price', value: `$${price.current_price.toLocaleString()}`, inline: true },
          { name: '24h change', value: `${change24h >= 0 ? '+' : ''}${change24h?.toFixed(2)}%`, inline: true },
          { name: 'Market cap', value: `$${(price.market_cap / 1e9).toFixed(2)}B`, inline: true },
          { name: '24h volume', value: `$${(price.total_volume / 1e9).toFixed(2)}B`, inline: true },
          { name: 'All-time high', value: `$${price.ath?.toLocaleString()}`, inline: true },
          { name: 'All-time low', value: `$${price.atl?.toLocaleString()}`, inline: true },
            )
            .setFooter({ text: 'CoinGecko • live market data' })
            .setTimestamp();
          await interaction.editReply({ embeds: [embed] });
        } else if (sub === 'address') {
          const addr = interaction.options.getString('address');
          let data;
          switch (group) {
            case 'bitcoin': data = await crypto.getBitcoinAddress(addr); break;
            case 'ethereum': data = await crypto.getEthereumAddress(addr); break;
            case 'solana': data = await crypto.getSolanaAddress(addr); break;
            case 'litecoin': data = await crypto.getLitecoinAddress(addr); break;
          }
          const embed = new EmbedBuilder().setColor(chain.color)
            .setTitle(`${chain.name} Address Balance`)
            .addFields(
          { name: 'Address', value: `\`${addr.slice(0, 20)}...\`` },
          { name: 'Balance', value: `${data.balance} ${chain.symbol}`, inline: true },
            )
            .setFooter({ text: `${addressSource(group)} • live blockchain data` })
            .setTimestamp();
        if (data.totalReceived !== undefined) embed.addFields({ name: 'Received', value: `${data.totalReceived} ${chain.symbol}`, inline: true });
        if (data.txCount !== undefined) embed.addFields({ name: 'Transactions', value: `${data.txCount}`, inline: true });
          await interaction.editReply({ embeds: [embed] });
        }
      }
    } catch (err) {
      await interaction.editReply({ content: `Error: ${err.message}` });
    }
  },
};

function addressSource(chain) {
  return {
    bitcoin: 'Blockchain.com',
    ethereum: 'Ethereum JSON-RPC',
    solana: 'Solana JSON-RPC',
    litecoin: 'BlockCypher',
  }[chain] || 'Blockchain API';
}

