const axios = require('axios');
const { EmbedBuilder, SlashCommandBuilder } = require('discord.js');
const { getDatabase } = require('../../../database/db');
const { colors } = require('../../../utils/constants');
const { getPublicStream } = require('../../../utils/network');

const SERVICES = {
  website: 'https://xocat.online/bot',
  discord: 'https://discord.com/api/v10/gateway',
  roblox: 'https://users.roblox.com/v1/users/1',
  github: 'https://api.github.com',
  npm: 'https://registry.npmjs.org/npm/latest',
};

async function checkUrl(label, url) {
  const startedAt = Date.now();
  try {
    const response = await getPublicStream(axios, url, { timeout: 8000, maxRedirects: 4 });
    response.data.destroy();
    return { label, ok: response.status < 500, status: response.status, ms: Date.now() - startedAt };
  } catch (error) {
    return { label, ok: false, error: String(error.message || error).slice(0, 120), ms: Date.now() - startedAt };
  }
}

function resultLine(result) {
  return `${result.ok ? '●' : '○'} **${result.label}** — ${result.ok ? `HTTP ${result.status}` : result.error} · ${result.ms}ms`;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('status')
    .setDescription('Check the bot, database, website, APIs, or a public endpoint')
    .addSubcommand(subcommand => subcommand
      .setName('bot')
      .setDescription('Show bot process and Discord connection status')
      .addBooleanOption(option => option.setName('quiet').setDescription('Only show the response to you')))
    .addSubcommand(subcommand => subcommand
      .setName('services')
      .setDescription('Check the website and core public APIs')
      .addBooleanOption(option => option.setName('quiet').setDescription('Only show the response to you')))
    .addSubcommand(subcommand => subcommand
      .setName('endpoint')
      .setDescription('Check a public HTTP or HTTPS endpoint')
      .addStringOption(option => option.setName('url').setDescription('Public URL to check').setRequired(true).setMaxLength(1000))
      .addBooleanOption(option => option.setName('quiet').setDescription('Only show the response to you'))),

  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();
    const quiet = interaction.options.getBoolean('quiet') ?? false;
    await interaction.deferReply({ flags: quiet ? 64 : undefined });
    if (subcommand === 'bot') {
      let databaseStatus = 'Available';
      try { getDatabase().exec('SELECT 1'); } catch { databaseStatus = 'Unavailable'; }
      const memory = process.memoryUsage();
      const uptime = Math.floor(process.uptime());
      const embed = new EmbedBuilder()
        .setColor(colors.utility)
        .setTitle('Bot status')
        .setDescription('The bot process is responding to Discord interactions.')
        .addFields(
          { name: 'Discord', value: `WebSocket ${interaction.client.ws.ping}ms`, inline: true },
          { name: 'Database', value: databaseStatus, inline: true },
          { name: 'Servers', value: interaction.client.guilds.cache.size.toLocaleString(), inline: true },
          { name: 'Commands', value: interaction.client.commands.size.toLocaleString(), inline: true },
          { name: 'Uptime', value: `${Math.floor(uptime / 86400)}d ${Math.floor((uptime % 86400) / 3600)}h ${Math.floor((uptime % 3600) / 60)}m`, inline: true },
          { name: 'Memory', value: `${(memory.rss / 1024 / 1024).toFixed(1)} MB RSS`, inline: true }
        )
        .setFooter({ text: `Node ${process.version} · PID ${process.pid}` })
        .setTimestamp();
      return interaction.editReply({ embeds: [embed] });
    }

    const results = subcommand === 'services'
      ? await Promise.all(Object.entries(SERVICES).map(([label, url]) => checkUrl(label, url)))
      : [await checkUrl('Custom endpoint', interaction.options.getString('url', true))];
    const online = results.filter(result => result.ok).length;
    const embed = new EmbedBuilder()
      .setColor(colors.utility)
      .setTitle(subcommand === 'services' ? 'Service status' : 'Endpoint status')
      .setDescription(results.map(resultLine).join('\n'))
      .setFooter({ text: `${online}/${results.length} checks passed from the bot host` })
      .setTimestamp();
    return interaction.editReply({ embeds: [embed] });
  },

  checkUrl,
};
