// /screenshot — Website screenshot
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const net = require('net');
const { colors } = require('../../../utils/constants');

module.exports = {
  prefixAliases: ['ss', 'shot', 'webshot'],
  data: new SlashCommandBuilder().setName('screenshot').setDescription('Take a screenshot of a website')
    .addStringOption(o => o.setName('url').setDescription('Public website URL').setRequired(true).setMaxLength(1000)).addBooleanOption(
    o => o.setName("quiet").setDescription("Make the response only visible to you").setRequired(false)
  ),
  async execute(interaction) {
    const quiet = interaction.options.getBoolean("quiet") ?? false;
    await interaction.deferReply({
      flags: quiet ? 64 : undefined
    });
    try {
      const url = interaction.options.getString('url');
      const fullUrl = normalizePublicHttpUrl(url);
      const screenshotUrl = `https://image.thum.io/get/width/1280/crop/720/${fullUrl}`;
      const displayUrl = fullUrl.length > 200 ? `${fullUrl.slice(0, 197)}...` : fullUrl;
      const embed = new EmbedBuilder().setColor(colors.utility).setTitle('Website screenshot')
        .setDescription(`[${displayUrl}](${fullUrl})`)
        .setImage(screenshotUrl)
        .setFooter({ text: 'Thum.io • 1280 × 720 capture' })
        .setTimestamp();
      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      await interaction.editReply({ content: `❌ Could not create screenshot: ${error.message}` });
    }
  },
};

function normalizePublicHttpUrl(value) {
  const input = /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`;
  let parsed;
  try {
    parsed = new URL(input);
  } catch {
    throw new Error('Please provide a valid website URL.');
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('Only HTTP and HTTPS URLs are supported.');
  }
  if (parsed.username || parsed.password) {
    throw new Error('URLs containing credentials are not supported.');
  }

  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (!hostname || hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local') || hostname.endsWith('.internal')) {
    throw new Error('Please provide a public website URL.');
  }

  const ipVersion = net.isIP(hostname);
  if (ipVersion === 0 && !hostname.includes('.')) {
    throw new Error('Please provide a public website URL.');
  }
  if ((ipVersion === 4 && isPrivateIpv4(hostname)) || (ipVersion === 6 && isPrivateIpv6(hostname))) {
    throw new Error('Private or local network addresses are not supported.');
  }

  return parsed.toString();
}

function isPrivateIpv4(hostname) {
  const [a, b] = hostname.split('.').map(Number);
  return a === 0 || a === 10 || a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224;
}

function isPrivateIpv6(hostname) {
  const value = hostname.toLowerCase();
  return value === '::' || value === '::1' || value.startsWith('::ffff:') ||
    value.startsWith('fc') || value.startsWith('fd') ||
    /^fe[89ab]/.test(value) || value.startsWith('ff');
}

