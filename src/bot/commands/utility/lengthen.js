// ============================================================
// /lengthen — expand a shortened URL
// ============================================================
const axios = require('axios');
const { EmbedBuilder, SlashCommandBuilder } = require('discord.js');
const { colors } = require('../../../utils/constants');
const { resolvePublicUrl } = require('../../../utils/network');

const MAX_HOPS = 10;

/**
 * Walk the redirect chain one hop at a time. Every hop is re-validated against
 * the private-address blocklist, so a shortener cannot be used to point the bot
 * at an internal service.
 */
async function followRedirects(input) {
  const hops = [];
  let current = input;

  for (let hop = 0; hop < MAX_HOPS; hop += 1) {
    const resolved = await resolvePublicUrl(current);
    hops.push(resolved.url);

    let response;
    try {
      response = await axios.head(resolved.url, {
        timeout: 10000,
        maxRedirects: 0,
        validateStatus: () => true,
      });
    } catch {
      // Some shorteners reject HEAD; fall back to a ranged GET.
      response = await axios.get(resolved.url, {
        timeout: 10000,
        maxRedirects: 0,
        validateStatus: () => true,
        headers: { Range: 'bytes=0-0' },
      });
    }

    const location = response.headers?.location;
    if (response.status < 300 || response.status >= 400 || !location) {
      return { hops, final: resolved.url, status: response.status };
    }

    current = new URL(location, resolved.url).toString();
  }

  throw new Error('That URL redirects too many times.');
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('lengthen')
    .setDescription('Expand a shortened URL to see where it actually goes')
    .addStringOption(o => o
      .setName('url')
      .setDescription('The short URL to expand')
      .setRequired(true)
      .setMaxLength(2000))
    .addBooleanOption(o => o.setName('quiet').setDescription('Make the response only visible to you').setRequired(false)),

  prefixAliases: ['longurl', 'lengthenurl', 'unshorten', 'expand'],

  async execute(interaction) {
    const quiet = interaction.options.getBoolean('quiet') ?? false;
    const url = interaction.options.getString('url').trim();

    await interaction.deferReply({ flags: quiet ? 64 : undefined });

    try {
      const { hops, final, status } = await followRedirects(url);

      if (hops.length === 1) {
        return interaction.editReply(`That URL does not redirect anywhere — it already points at <${final}> (HTTP ${status}).`);
      }

      const embed = new EmbedBuilder()
        .setColor(colors.utility)
        .setTitle('Expanded URL')
        .setDescription(`\`\`\`\n${hops.map((hop, index) => `${index + 1}. ${hop}`).join('\n')}\n\`\`\``.slice(0, 4000))
        .addFields(
          { name: 'Destination', value: `<${final}>`.slice(0, 1024) },
          { name: 'Redirects', value: String(hops.length - 1), inline: true },
          { name: 'Final status', value: String(status), inline: true },
        )
        .setTimestamp();

      return interaction.editReply({ embeds: [embed] });
    } catch (error) {
      return interaction.editReply(`❌ ${error.message}`);
    }
  },
};
