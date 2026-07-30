const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, SlashCommandBuilder } = require('discord.js');
const { colors } = require('../../../utils/constants');

function validHttpUrl(value) {
  try { return ['http:', 'https:'].includes(new URL(value).protocol); }
  catch { return false; }
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('invite')
    .setDescription('Get the bot invite link and related links')
    .addBooleanOption(o => o.setName('quiet').setDescription('Make the response only visible to you')),

  async execute(interaction) {
    const quiet = interaction.options.getBoolean('quiet') ?? false;
    const inviteUrl = process.env.BOT_INSTALL_URL || 'https://xocat.online/bot/install';
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Add to Discord').setURL(inviteUrl)
    );
    const optionalLinks = [
      ['Support server', process.env.SUPPORT_SERVER_URL || process.env.DISCORD_SUPPORT_URL],
      ['Dashboard', process.env.DASHBOARD_URL],
      ['Website', process.env.BOT_WEBSITE_URL || process.env.WEBSITE_URL || 'https://xocat.online/bot'],
    ];
    for (const [label, url] of optionalLinks) {
      if (url && validHttpUrl(url) && row.components.length < 5) row.addComponents(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel(label).setURL(url));
    }
    const embed = new EmbedBuilder()
      .setColor(colors.primary)
      .setTitle(`Invite ${interaction.client.user.username}`)
      .setDescription('Choose a server-wide or personal installation. Discord will let you review the requested access before authorizing it.')
      .setThumbnail(interaction.client.user.displayAvatarURL({ size: 256 }))
      .setFooter({ text: 'The install page supports server and DM use' });
    return interaction.reply({ embeds: [embed], components: [row], flags: quiet ? 64 : undefined });
  },

  validHttpUrl,
};
