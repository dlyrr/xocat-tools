const { SlashCommandBuilder, AttachmentBuilder, EmbedBuilder } = require('discord.js');
const { colors } = require('../../../utils/constants');
const axios = require('axios');
const sharp = require('sharp');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
const fs = require('fs');
const path = require('path');
const os = require('os');
const {
  MediaNotFoundError,
  looksLikeImage,
  looksLikeVideo,
  requireMedia,
} = require('../../../services/mediaResolver');

ffmpeg.setFfmpegPath(ffmpegPath);

module.exports = {
  data: new SlashCommandBuilder()
    .setName('compress')
    .setDescription('Compress an image or video to a target size')
    .addIntegerOption(o => o.setName('mb').setDescription('Maximum output size in MB').setRequired(true).setMinValue(1).setMaxValue(25))
    .addAttachmentOption(o => o.setName('file').setDescription('Image or video to compress (defaults to the most recent one in the channel)').setRequired(false))
    .addStringOption(o => o.setName('link').setDescription('A media URL to compress instead of an attachment').setRequired(false).setMaxLength(500))
    .addBooleanOption(o => o.setName('quiet').setDescription('Make the response only visible to you').setRequired(false)),

  prefixAliases: ['shrink'],

  async execute(interaction) {
    const quiet = interaction.options.getBoolean('quiet') ?? false;
    const targetMB = interaction.options.getInteger('mb');
    const targetBytes = targetMB * 1024 * 1024;

    await interaction.deferReply({ flags: quiet ? 64 : undefined });

    let file;
    try {
      file = await requireMedia(interaction, {
        allowVideo: true,
        userOption: null,
        noMediaMessage: 'I could not find anything to compress. Attach an image or video, reply to a message with one, or paste a link.',
      });
    } catch (error) {
      if (error instanceof MediaNotFoundError) return interaction.editReply(`❌ ${error.message}`);
      throw error;
    }

    const safeName = path.basename(file.name || 'upload');
    const isVideo = looksLikeVideo(file.url, file.contentType);
    const isImage = !isVideo && looksLikeImage(file.url, file.contentType) && file.contentType !== 'image/gif' && !/\.gif(\?|#|$)/i.test(file.url);

    if (!isImage && !isVideo) {
      return interaction.editReply('❌ Unsupported file type. Use a PNG/JPEG/WebP image or a video.');
    }
    if (isImage && Number.isFinite(file.size) && file.size > 20 * 1024 * 1024) {
      return interaction.editReply('❌ Image is larger than the 20 MB processing limit.');
    }
    if (isVideo && Number.isFinite(file.size) && file.size > 100 * 1024 * 1024) {
      return interaction.editReply('❌ Video is larger than the 100 MB processing limit.');
    }
    if (Number.isFinite(file.size) && file.size <= targetBytes) {
      return interaction.editReply(`✅ Already below ${targetMB} MB (${formatMB(file.size)} MB).`);
    }

    const id = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const tempIn = path.join(os.tmpdir(), `compress_in_${id}_${safeName}`);
    const tempOut = path.join(os.tmpdir(), `compress_out_${id}.${isImage ? 'jpg' : 'mp4'}`);
    const outputName = `compressed_${path.parse(safeName).name}.${isImage ? 'jpg' : 'mp4'}`;

    try {
      await downloadFile(file.url, tempIn);
      // A resolved URL may not report a size up front, so measure what we got.
      const originalSize = Number.isFinite(file.size) ? file.size : fs.statSync(tempIn).size;
      if (originalSize <= targetBytes) {
        return interaction.editReply(`✅ Already below ${targetMB} MB (${formatMB(originalSize)} MB).`);
      }

      if (isImage) {
        await interaction.editReply('⚙️ Compressing image...');
        await compressImage(tempIn, tempOut, targetBytes);
      } else {
        await interaction.editReply('⚙️ Compressing video...');
        await compressVideo(tempIn, tempOut, targetBytes);
      }

      const finalSize = fs.statSync(tempOut).size;
      if (finalSize > targetBytes) {
        throw new Error(`Could not reach ${targetMB} MB without making the file unusable.`);
      }

      const embed = new EmbedBuilder()
        .setColor(colors.utility)
        .setTitle('Compression Complete')
        .addFields(
          { name: 'Original', value: `${formatMB(originalSize)} MB`, inline: true },
          { name: 'Output', value: `${formatMB(finalSize)} MB`, inline: true },
          { name: 'Format', value: isImage ? 'JPEG' : 'MP4', inline: true },
        )
        .setFooter({ text: `Requested maximum • ${targetMB} MB` })
        .setTimestamp();

      await interaction.editReply({
        embeds: [embed],
        files: [new AttachmentBuilder(tempOut, { name: outputName })],
      });
    } catch (error) {
      console.error('[COMPRESS] Error:', error);
      await interaction.editReply(`❌ Compression failed: ${error.message}`);
    } finally {
      removeFile(tempIn);
      removeFile(tempOut);
    }
  },
};

async function downloadFile(url, destination) {
  const response = await axios.get(url, {
    responseType: 'stream',
    timeout: 30000,
    maxContentLength: 100 * 1024 * 1024,
  });
  await new Promise((resolve, reject) => {
    const writer = fs.createWriteStream(destination);
    response.data.pipe(writer);
    writer.on('finish', resolve);
    writer.on('error', reject);
    response.data.on('error', reject);
  });
}

async function compressImage(input, output, targetBytes) {
  const metadata = await sharp(input).metadata();
  let width = metadata.width || 1920;
  let quality = 85;
  let buffer;

  for (let attempt = 0; attempt < 18; attempt++) {
    buffer = await sharp(input)
      .rotate()
      .resize({ width, withoutEnlargement: true })
      .jpeg({ quality, mozjpeg: true })
      .toBuffer();

    if (buffer.length <= targetBytes) break;
    if (quality > 35) quality -= 10;
    else width = Math.max(320, Math.floor(width * 0.8));
  }

  if (!buffer || buffer.length > targetBytes) {
    throw new Error('The image could not be compressed to the requested size.');
  }
  fs.writeFileSync(output, buffer);
}

async function compressVideo(input, output, targetBytes) {
  const metadata = await ffprobe(input);
  const duration = Number(metadata.format?.duration);
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('Could not determine video duration.');

  const audioKbps = 96;
  let videoKbps = Math.floor(((targetBytes * 8 * 0.92) / duration) / 1000) - audioKbps;
  if (videoKbps < 64) throw new Error('The target size is too small for this video length.');

  for (let attempt = 0; attempt < 3; attempt++) {
    removeFile(output);
    await encodeVideo(input, output, videoKbps, audioKbps);
    const size = fs.statSync(output).size;
    if (size <= targetBytes) return;
    videoKbps = Math.floor(videoKbps * (targetBytes / size) * 0.94);
    if (videoKbps < 64) break;
  }

  throw new Error('The video could not be compressed to the requested size.');
}

function ffprobe(input) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(input, (error, data) => error ? reject(error) : resolve(data));
  });
}

function encodeVideo(input, output, videoKbps, audioKbps) {
  return new Promise((resolve, reject) => {
    ffmpeg(input)
      .videoCodec('libx264')
      .audioCodec('aac')
      .videoBitrate(videoKbps)
      .audioBitrate(audioKbps)
      .size('?x480')
      .outputOptions(['-movflags +faststart'])
      .format('mp4')
      .on('error', reject)
      .on('end', resolve)
      .save(output);
  });
}

function removeFile(file) {
  try { if (fs.existsSync(file)) fs.unlinkSync(file); } catch { }
}

function formatMB(bytes) {
  return (bytes / 1024 / 1024).toFixed(2);
}
