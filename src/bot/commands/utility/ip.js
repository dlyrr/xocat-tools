// /ip — IP utilities
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { colors } = require('../../../utils/constants');
const axios = require('axios');
const { getPublicStream } = require('../../../utils/network');

module.exports = {
  prefixAliases: ['ipinfo'],
  data: new SlashCommandBuilder()
    .setName('ip')
    .setDescription('IP utilities')
    .addSubcommand(s => s.setName('lookup').setDescription('Lookup IP address information').addStringOption(o => o.setName('ip').setDescription('IP address').setRequired(true)).addBooleanOption(
    o => o.setName("quiet").setDescription("Make the response only visible to you").setRequired(false)
  ))
    .addSubcommand(s => s.setName('ping').setDescription('Measure HTTPS response time from the bot host').addStringOption(o => o.setName('host').setDescription('Hostname or URL').setRequired(true).setMaxLength(2000)).addBooleanOption(
    o => o.setName("quiet").setDescription("Make the response only visible to you").setRequired(false)
  ))
    .addSubcommand(s => s.setName('http').setDescription('Check an HTTP response from the bot host').addStringOption(o => o.setName('url').setDescription('URL to check').setRequired(true).setMaxLength(2000)).addBooleanOption(
    o => o.setName("quiet").setDescription("Make the response only visible to you").setRequired(false)
  )),
  async execute(interaction) {
    const quiet = interaction.options.getBoolean("quiet") ?? false;
    await interaction.deferReply({
      flags: quiet ? 64 : undefined
    });
    const sub = interaction.options.getSubcommand();
    try {
      if (sub === 'lookup') {
        const ip = interaction.options.getString('ip');
        const { data } = await axios.get(`http://ip-api.com/json/${encodeURIComponent(ip)}?fields=status,message,country,countryCode,region,regionName,city,zip,lat,lon,timezone,isp,org,as,query`, { timeout: 5000 });
        if (data.status === 'fail') return interaction.editReply({ content: `❌ ${data.message}` });
        const embed = new EmbedBuilder().setColor(colors.utility).setTitle(`IP lookup: ${data.query}`)
          .addFields(
            { name: 'Location', value: `${data.city}, ${data.regionName}, ${data.country}`, inline: true },
            { name: 'ISP', value: data.isp || 'N/A', inline: true },
            { name: 'Organization', value: data.org || 'N/A', inline: true },
            { name: 'Timezone', value: data.timezone || 'N/A', inline: true },
            { name: 'Postal code', value: data.zip || 'N/A', inline: true },
            { name: 'Autonomous system', value: data.as || 'N/A', inline: true },
            { name: 'Coordinates', value: `${data.lat}, ${data.lon}`, inline: true },
          ).setTimestamp();
        await interaction.editReply({ embeds: [embed] });
      } else if (sub === 'ping') {
        const host = interaction.options.getString('host');
        const start = Date.now();
        try {
          const response = await getPublicStream(axios, host, { timeout: 5000, maxRedirects: 5, forceHttps: true });
          response.data.destroy();
          const ms = Date.now() - start;
          const color = response.status < 400 ? colors.utility : response.status < 500 ? colors.warning : colors.error;
          const embed = new EmbedBuilder().setColor(color).setTitle(`HTTPS check: ${host.slice(0, 230)}`)
            .setDescription(`**${ms}ms** response time — HTTP ${response.status}`).setTimestamp();
          await interaction.editReply({ embeds: [embed] });
        } catch (error) {
          const embed = new EmbedBuilder().setColor(colors.error).setTitle(`HTTPS check: ${host.slice(0, 230)}`)
            .setDescription(String(error.message).slice(0, 1000)).setTimestamp();
          await interaction.editReply({ embeds: [embed] });
        }
      } else if (sub === 'http') {
        const url = interaction.options.getString('url');
        const start = Date.now();
        try {
          const resp = await getPublicStream(axios, url, { timeout: 10000, maxRedirects: 5 });
          resp.data.destroy();
          const ms = Date.now() - start;
          const color = resp.status < 400 ? colors.utility : resp.status < 500 ? colors.warning : colors.error;
          const embed = new EmbedBuilder().setColor(color).setTitle(`HTTP check: ${url.slice(0, 232)}`)
            .addFields(
              { name: 'Status', value: `${resp.status} ${resp.statusText}`, inline: true },
              { name: 'Response Time', value: `${ms}ms`, inline: true },
              { name: 'Content-Type', value: resp.headers['content-type'] || 'N/A', inline: true },
            ).setTimestamp();
          await interaction.editReply({ embeds: [embed] });
        } catch (err) {
          const embed = new EmbedBuilder().setColor(colors.error).setTitle(`HTTP check: ${url.slice(0, 232)}`)
            .setDescription(String(err.message).slice(0, 1000)).setTimestamp();
          await interaction.editReply({ embeds: [embed] });
        }
      }
    } catch (err) { await interaction.editReply({ content: `❌ Error: ${err.message}` }); }
  },
};

