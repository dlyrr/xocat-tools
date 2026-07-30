const { SlashCommandBuilder, AttachmentBuilder, EmbedBuilder } = require('discord.js');
const { colors } = require('../../../utils/constants');
const axios = require('axios');
const sharp = require('sharp');

const MAX_INPUT_BYTES = 15 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 10 * 1024 * 1024;
const MAX_CROP_FRACTION = 0.4;
const UNIFORM_THRESHOLD = 0.8;
const MIN_BAR_HEIGHT = 12;
const NEAR_WHITE = 235;
const NEAR_BLACK = 20;

module.exports = {
  data: new SlashCommandBuilder()
    .setName('uncaption')
    .setDescription('Remove a meme-style caption bar from an image or GIF')
    .addAttachmentOption(o => o.setName('file').setDescription('The captioned image or GIF').setRequired(true))
    .addBooleanOption(o => o.setName('quiet').setDescription('Make the response only visible to you').setRequired(false)),

  async execute(interaction) {
    const quiet = interaction.options.getBoolean('quiet') ?? false;
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

      const result = await uncaptionImage(response.data);

      if (!result.cropped) {
        return interaction.editReply('❌ No caption bar detected — the image looks uncropped already.');
      }

      if (result.buffer.length > MAX_OUTPUT_BYTES) {
        throw new Error('The result is larger than 10MB. Try a smaller source file.');
      }

      const extension = result.isAnimated ? 'gif' : 'png';
      const attachment = new AttachmentBuilder(result.buffer, { name: `uncaptioned.${extension}` });

      const embed = new EmbedBuilder()
        .setColor(colors.utility)
        .setTitle('Caption Removed')
        .addFields(
          { name: 'Cropped', value: [
            result.top > 0 ? `${result.top}px top` : null,
            result.bottom > 0 ? `${result.bottom}px bottom` : null,
          ].filter(Boolean).join(', '), inline: true },
          { name: 'Output', value: `${(result.buffer.length / 1024 / 1024).toFixed(2)} MB`, inline: true },
        )
        .setTimestamp();

      await interaction.editReply({ embeds: [embed], files: [attachment] });
    } catch (err) {
      console.error('[UNCAPTION] Error:', err);
      await interaction.editReply(`❌ Failed to remove caption: ${err.message}`);
    }
  },
};

async function uncaptionImage(inputBuffer) {
  const meta = await sharp(inputBuffer, { animated: true }).metadata();
  const isAnimated = (meta.pages || 1) > 1;
  const width = meta.width;
  const pageHeight = meta.pageHeight || meta.height;

  // Only the first frame is analyzed — a caption bar added by /caption (or most
  // meme tools) occupies the same rows on every frame, so one pass is enough.
  const { data, info } = await sharp(inputBuffer, { page: 0 })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { top, bottom } = detectBars(data, info.width, info.height);

  if (top === 0 && bottom === 0) {
    return { isAnimated, cropped: false };
  }

  const newPageHeight = pageHeight - top - bottom;
  const pipeline = sharp(inputBuffer, { animated: true }).extract({
    left: 0,
    top,
    width,
    height: newPageHeight,
  });

  const buffer = await (isAnimated ? pipeline.gif() : pipeline.png()).toBuffer();

  return { buffer, isAnimated, cropped: true, top, bottom };
}

function detectBars(data, width, height) {
  const channels = data.length / (width * height);
  const rowUniformFraction = new Array(height);

  for (let y = 0; y < height; y++) {
    let flatCount = 0;
    const rowStart = y * width * channels;
    for (let x = 0; x < width; x++) {
      const i = rowStart + x * channels;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const isNearWhite = r >= NEAR_WHITE && g >= NEAR_WHITE && b >= NEAR_WHITE;
      const isNearBlack = r <= NEAR_BLACK && g <= NEAR_BLACK && b <= NEAR_BLACK;
      if (isNearWhite || isNearBlack) flatCount++;
    }
    rowUniformFraction[y] = flatCount / width;
  }

  const maxCrop = Math.floor(height * MAX_CROP_FRACTION);

  const top = scanEdge(rowUniformFraction, height, maxCrop, y => y);
  const bottom = scanEdge(rowUniformFraction, height, maxCrop, y => height - 1 - y);

  return {
    top: top < MIN_BAR_HEIGHT ? 0 : top,
    bottom: bottom < MIN_BAR_HEIGHT ? 0 : bottom,
  };
}

// Bold anti-aliased text briefly dips a row's flat-pixel fraction below the
// threshold even inside the caption bar, so a hard cutoff on the first failing
// row stops partway through the text. Bridge short dips (FAIL_TOLERANCE rows)
// and only commit to a boundary once real content fails for that many rows in
// a row — `crop` is only advanced on a pass, so a genuine stop rolls back to
// the last confirmed-flat row instead of including the failing tail.
const FAIL_TOLERANCE = 3;

function scanEdge(rowUniformFraction, height, maxCrop, indexAt) {
  let crop = 0;
  let failRun = 0;
  for (let i = 0; i < maxCrop; i++) {
    if (rowUniformFraction[indexAt(i)] >= UNIFORM_THRESHOLD) {
      failRun = 0;
      crop = i + 1;
    } else if (++failRun >= FAIL_TOLERANCE) {
      break;
    }
  }
  return crop;
}
