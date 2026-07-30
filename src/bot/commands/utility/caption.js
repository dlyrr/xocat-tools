const { SlashCommandBuilder, AttachmentBuilder, EmbedBuilder } = require('discord.js');
const { colors } = require('../../../utils/constants');
const axios = require('axios');
const sharp = require('sharp');
const path = require('path');

const MAX_INPUT_BYTES = 15 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 10 * 1024 * 1024;
const MAX_WIDTH = 800;
const CAPTION_FONT_FILE = path.join(__dirname, '../../../../assets/fonts/FuturaCyrillicExtraBold.ttf');
const CAPTION_FONT_FAMILY = 'Futura Cyrillic Extra Bold';

module.exports = {
  data: new SlashCommandBuilder()
    .setName('caption')
    .setDescription('Add a meme-style caption bar to an image or GIF')
    .addAttachmentOption(o => o.setName('file').setDescription('The image or GIF to caption').setRequired(true))
    .addStringOption(o => o.setName('text').setDescription('The caption text').setRequired(true).setMaxLength(200))
    .addStringOption(o => o.setName('position').setDescription('Where to place the caption bar').setRequired(false)
      .addChoices({ name: 'Top', value: 'top' }, { name: 'Bottom', value: 'bottom' }))
    .addBooleanOption(o => o.setName('quiet').setDescription('Make the response only visible to you').setRequired(false)),

  async execute(interaction) {
    const quiet = interaction.options.getBoolean('quiet') ?? false;
    const text = interaction.options.getString('text');
    const position = interaction.options.getString('position') ?? 'top';
    const file = interaction.options.getAttachment('file');

    await interaction.deferReply({ flags: quiet ? 64 : undefined });

    const isImage = file.contentType?.startsWith('image/') || /\.(png|jpe?g|webp|gif)$/i.test(file.url);
    if (!isImage) {
      return interaction.editReply('❌ Unsupported file type! Please upload a PNG, JPEG, WebP, or GIF.');
    }
    if (file.size > MAX_INPUT_BYTES) {
      return interaction.editReply('❌ File is too large! Please upload a file under 15MB.');
    }

    try {
      const response = await axios.get(file.url, {
        responseType: 'arraybuffer',
        timeout: 30000,
        maxContentLength: MAX_INPUT_BYTES,
      });

      const { buffer: outputBuffer, isAnimated } = await captionImage(response.data, text, position);

      if (outputBuffer.length > MAX_OUTPUT_BYTES) {
        throw new Error('The captioned result is larger than 10MB. Try a smaller source file.');
      }

      const extension = isAnimated ? 'gif' : 'png';
      const attachment = new AttachmentBuilder(outputBuffer, { name: `captioned.${extension}` });

      const embed = new EmbedBuilder()
        .setColor(colors.utility)
        .setTitle('Caption Added')
        .addFields(
          { name: 'Position', value: position === 'top' ? 'Top' : 'Bottom', inline: true },
          { name: 'Output', value: `${(outputBuffer.length / 1024 / 1024).toFixed(2)} MB`, inline: true },
        )
        .setTimestamp();

      await interaction.editReply({ embeds: [embed], files: [attachment] });
    } catch (err) {
      console.error('[CAPTION] Error:', err);
      await interaction.editReply(`❌ Failed to caption: ${err.message}`);
    }
  },
};

async function captionImage(inputBuffer, text, position) {
  const meta = await sharp(inputBuffer, { animated: true }).metadata();
  const isAnimated = (meta.pages || 1) > 1;

  let width = meta.width || MAX_WIDTH;
  if (width > MAX_WIDTH) width = MAX_WIDTH;

  const resized = sharp(inputBuffer, { animated: true }).resize({ width, withoutEnlargement: true });
  const resizedBuffer = await (isAnimated ? resized.gif() : resized.png()).toBuffer();
  const resizedMeta = await sharp(resizedBuffer, { animated: true }).metadata();
  const finalWidth = resizedMeta.width;

  const hPad = Math.max(16, Math.round(finalWidth * 0.05));
  const vPad = Math.max(14, Math.round(finalWidth * 0.045));
  const fontSize = Math.min(56, Math.max(22, Math.round(finalWidth / 11)));

  const textBuffer = await sharp({
    text: {
      text: escapePango(text),
      font: `${CAPTION_FONT_FAMILY} ${fontSize}`,
      fontfile: CAPTION_FONT_FILE,
      width: finalWidth - hPad * 2,
      align: 'center',
      rgba: true,
    },
  }).png().toBuffer();
  const textMeta = await sharp(textBuffer).metadata();

  const barHeight = textMeta.height + vPad * 2;
  const pageHeight = resizedMeta.pageHeight || resizedMeta.height;

  const bar = await sharp({
    create: { width: finalWidth, height: barHeight, channels: 4, background: '#ffffff' },
  }).composite([{ input: textBuffer, gravity: 'centre' }]).png().toBuffer();

  const extendOptions = { background: '#ffffff' };
  if (position === 'bottom') {
    extendOptions.bottom = barHeight;
  } else {
    extendOptions.top = barHeight;
  }

  // For animated images, `tile: true` repeats the overlay at a fixed pixel
  // period across the whole stacked canvas, so it only lines up with each
  // frame if the overlay is exactly one new (extended) page tall.
  let overlay = bar;
  let overlayTop = position === 'bottom' ? pageHeight : 0;
  if (isAnimated) {
    const newPageHeight = pageHeight + barHeight;
    overlay = await sharp({
      create: { width: finalWidth, height: newPageHeight, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    }).composite([{ input: bar, top: position === 'bottom' ? pageHeight : 0, left: 0 }]).png().toBuffer();
    overlayTop = 0;
  }

  let pipeline = sharp(resizedBuffer, { animated: true }).extend(extendOptions);
  pipeline = pipeline.composite([{ input: overlay, top: overlayTop, left: 0, tile: isAnimated }]);

  const outputBuffer = await (isAnimated ? pipeline.gif() : pipeline.png()).toBuffer();

  return { buffer: outputBuffer, isAnimated };
}

function escapePango(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
