const { SlashCommandBuilder } = require('discord.js');
const { sendDownloadedMedia } = require('../utility/scrape');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('tiktok')
    .setDescription('Download and repost TikTok videos')
    .addSubcommand(s => s
      .setName('repost')
      .setDescription('Download and repost a TikTok video')
      .addStringOption(o => o.setName('url').setDescription('TikTok video URL').setRequired(true).setMaxLength(2000))
      .addBooleanOption(o => o.setName('quiet').setDescription('Make the response only visible to you').setRequired(false))),

  async execute(interaction) {
    const quiet = interaction.options.getBoolean('quiet') ?? false;
    const url = interaction.options.getString('url');

    await interaction.deferReply({ flags: quiet ? 64 : undefined });

    try {
      assertHostname(url, ['tiktok.com']);
      await sendDownloadedMedia(interaction, url);
    } catch (error) {
      await interaction.editReply({ content: `❌ TikTok download failed: ${error.message}` });
    }
  },
};

function assertHostname(value, domains) {
  const url = new URL(value);
  const hostname = url.hostname.toLowerCase();
  if (!domains.some(domain => hostname === domain || hostname.endsWith(`.${domain}`))) {
    throw new Error('Please provide a TikTok URL.');
  }
}
