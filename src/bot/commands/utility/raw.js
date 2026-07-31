// ============================================================
// /raw — get the direct file URL for an image
// ------------------------------------------------------------
// Handy for grabbing the actual GIF behind a Tenor/Giphy embed, or the CDN URL
// of a custom emoji, sticker, or avatar.
// ============================================================
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, SlashCommandBuilder } = require('discord.js');
const { colors } = require('../../../utils/constants');
const { MediaNotFoundError, requireMedia } = require('../../../services/mediaResolver');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('raw')
    .setDescription('Get the direct file URL of an image, GIF, emoji, sticker, or avatar')
    .addAttachmentOption(o => o
      .setName('file')
      .setDescription('The file to get a URL for (defaults to the most recent image in the channel)')
      .setRequired(false))
    .addStringOption(o => o
      .setName('link')
      .setDescription('A page or media URL, custom emoji, or user ID')
      .setRequired(false)
      .setMaxLength(500))
    .addUserOption(o => o
      .setName('user')
      .setDescription("Get the URL of this user's avatar")
      .setRequired(false))
    .addBooleanOption(o => o.setName('quiet').setDescription('Make the response only visible to you').setRequired(false)),

  prefixAliases: ['giflink', 'imglink', 'getimg', 'rawgif', 'rawimg'],

  async execute(interaction) {
    const quiet = interaction.options.getBoolean('quiet') ?? false;
    await interaction.deferReply({ flags: quiet ? 64 : undefined });

    let media;
    try {
      media = await requireMedia(interaction, { allowVideo: true });
    } catch (error) {
      if (error instanceof MediaNotFoundError) return interaction.editReply(`❌ ${error.message}`);
      throw error;
    }

    const embed = new EmbedBuilder()
      .setColor(colors.utility)
      .setTitle('Direct file URL')
      .setDescription(`\`\`\`\n${media.url.slice(0, 3900)}\n\`\`\``)
      .addFields(
        { name: 'Filename', value: media.name.slice(0, 1024), inline: true },
        { name: 'Found via', value: media.source, inline: true },
      )
      .setTimestamp();

    if (media.contentType?.startsWith('image/')) embed.setThumbnail(media.url);

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setLabel('Open in browser').setStyle(ButtonStyle.Link).setURL(media.url)
    );

    return interaction.editReply({ embeds: [embed], components: [row] });
  },
};
