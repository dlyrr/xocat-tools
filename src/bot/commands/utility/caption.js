// ============================================================
// /caption — add a caption bar to an image or GIF
// ------------------------------------------------------------
// Runs on the shared effect engine, so it gets esmBot's two caption styles
// (the tall Futura bar and the small iFunny-style bar), a font picker, GIF
// support, and the flexible image sourcing every media command shares.
// ============================================================
const { SlashCommandBuilder } = require('discord.js');
const { ALLOWED_FONTS } = require('../../../services/imageEffects');
const { runEffect } = require('../../../services/mediaCommand');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('caption')
    .setDescription('Add a meme-style caption bar to an image or GIF')
    .addStringOption(o => o
      .setName('text')
      .setDescription('The caption text')
      .setRequired(true)
      .setMaxLength(500))
    .addAttachmentOption(o => o
      .setName('file')
      .setDescription('The image or GIF to caption (defaults to the most recent one in the channel)')
      .setRequired(false))
    .addStringOption(o => o
      .setName('link')
      .setDescription('An image URL, custom emoji, or user ID to caption instead of an attachment')
      .setRequired(false)
      .setMaxLength(500))
    .addUserOption(o => o
      .setName('user')
      .setDescription("Caption this user's avatar")
      .setRequired(false))
    .addStringOption(o => o
      .setName('style')
      .setDescription('Caption style (default: bar)')
      .setRequired(false)
      .addChoices(
        { name: 'Bar — tall white bar, large centred text', value: 'caption' },
        { name: 'iFunny — small bar, left-aligned text', value: 'caption2' },
        { name: 'Whisper — large outlined text over the middle', value: 'whisper' },
        { name: 'Snapchat — translucent bar across the image', value: 'snapchat' },
      ))
    .addStringOption(o => o
      .setName('position')
      .setDescription('Which side the bar goes on')
      .setRequired(false)
      .addChoices(
        { name: 'Top', value: 'top' },
        { name: 'Bottom', value: 'bottom' },
      ))
    .addStringOption(o => o
      .setName('font')
      .setDescription('Font to use')
      .setRequired(false)
      .addChoices(...ALLOWED_FONTS.map(font => ({ name: font, value: font }))))
    .addBooleanOption(o => o.setName('quiet').setDescription('Make the response only visible to you').setRequired(false)),

  prefixGreedy: 'text',
  prefixAliases: ['cap'],

  async execute(interaction) {
    const style = interaction.options.getString('style') || 'caption';
    // The iFunny variant defaults to the bottom; the tall bar defaults to the top.
    const position = interaction.options.getString('position') || (style === 'caption2' ? 'bottom' : 'top');

    // whisper and snapchat overlay text rather than adding a bar, so the
    // style/position params do not apply to them.
    const overlay = style === 'whisper' || style === 'snapchat';

    return runEffect(interaction, style, {
      title: 'Caption',
      params: overlay ? {} : { style, position },
    });
  },
};
