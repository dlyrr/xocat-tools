const { SlashCommandBuilder, AttachmentBuilder, EmbedBuilder } = require('discord.js');
const { colors } = require('../../../utils/constants');
const axios = require('axios');
const sharp = require('sharp');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
const fs = require('fs');
const path = require('path');
const os = require('os');

ffmpeg.setFfmpegPath(ffmpegPath);

module.exports = {
  data: new SlashCommandBuilder()
    .setName('compress')
    .setDescription('Compress an image or video to a target size')
    .addAttachmentOption(o => o.setName('file').setDescription('Image or video to compress').setRequired(true))
    .addIntegerOption(o => o.setName('mb').setDescription('Maximum output size in MB').setRequired(true).setMinValue(1).setMaxValue(25))
    .addBooleanOption(o => o.setName('quiet').setDescription('Make the response only visible to you').setRequired(false)),

  async execute(interaction) {
    const quiet = interaction.options.getBoolean('quiet') ?? false;
    const targetMB = interaction.options.getInteger('mb');
    const targetBytes = targetMB * 1024 * 1024;
    const file = interaction.options.getAttachment('file');
    const safeName = path.basename(file.name || 'upload');
    const isVideo = file.contentType?.startsWith('video/');
    const isImage = file.contentType?.startsWith('image/') && file.contentType !== 'image/gif';

    await interaction.deferReply({ flags: quiet ? 64 : undefined });

    if (!isImage && !isVideo) {
      return interaction.editReply('❌ Unsupported file type. Use a PNG/JPEG/WebP image or a video.');
    }
    if (isImage && file.size > 20 * 1024 * 1024) {
      return interaction.editReply('❌ Image is larger than the 20 MB processing limit.');
    }
    if (isVideo && file.size > 100 * 1024 * 1024) {
      return interaction.editReply('❌ Video is larger than the 100 MB processing limit.');
    }
    if (file.size <= targetBytes) {
      return interaction.editReply(`✅ Already below ${targetMB} MB (${formatMB(file.size)} MB).`);
    }

    const id = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const tempIn = path.join(os.tmpdir(), `compress_in_${id}_${safeName}`);
    const tempOut = path.join(os.tmpdir(), `compress_out_${id}.${isImage ? 'jpg' : 'mp4'}`);
    const outputName = `compressed_${path.parse(safeName).name}.${isImage ? 'jpg' : 'mp4'}`;

    try {
      await downloadFile(file.url, tempIn);

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
          { name: 'Original', value: `${formatMB(file.size)} MB`, inline: true },
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
