const { SlashCommandBuilder, AttachmentBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType, EmbedBuilder } = require('discord.js');
const { colors } = require('../../../utils/constants');
const axios = require('axios');
const sharp = require('sharp');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { uploadFile } = require('../../../services/ezhostService');

ffmpeg.setFfmpegPath(ffmpegPath);

module.exports = {
  data: new SlashCommandBuilder()
    .setName('togif')
    .setDescription('Convert an image or video to a GIF')
    .addAttachmentOption(o => o.setName('file').setDescription('The image or video to convert').setRequired(true))
    .addBooleanOption(o => o.setName('upload-to-cloud').setDescription('Automatically upload the result to the cloud').setRequired(false))
    .addBooleanOption(o => o.setName('quiet').setDescription('Make the response only visible to you').setRequired(false)),

  async execute(interaction) {
    const quiet = interaction.options.getBoolean('quiet') ?? false;
    const autoUpload = interaction.options.getBoolean('upload-to-cloud') ?? false;
    await interaction.deferReply({ flags: quiet ? 64 : undefined });

    const file = interaction.options.getAttachment('file');

    // 1. Size Limit Check (5MB)
    if (file.size > 5 * 1024 * 1024) {
      return interaction.editReply('❌ File is too large! Please upload a file under 5MB.');
    }

    const isVideo = file.contentType?.startsWith('video/') || /\.(mp4|mov|webm)$/i.test(file.url);
    const isImage = file.contentType?.startsWith('image/') || /\.(png|jpe?g|webp)$/i.test(file.url);

    if (!isVideo && !isImage) {
      return interaction.editReply('❌ Unsupported file type! Please upload an image (PNG, JPEG, WebP) or video (MP4, MOV, WebM).');
    }

    let tempIn;
    let tempOut;
    try {
      let gifBuffer;
      const id = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      tempIn = path.join(os.tmpdir(), `gif_in_${id}_${path.basename(file.name || 'upload')}`);
      tempOut = path.join(os.tmpdir(), `gif_out_${id}.gif`);

      if (isImage) {
        const response = await axios.get(file.url, { responseType: 'arraybuffer', timeout: 30000 });
        gifBuffer = await sharp(response.data)
          .resize({ width: 480, withoutEnlargement: true })
          .gif({ effort: 7, colours: 256 })
          .toBuffer();
      } else {
        // Video processing with FFmpeg (palettegen -> paletteuse)
        const response = await axios.get(file.url, { responseType: 'stream' });
        const writer = fs.createWriteStream(tempIn);
        response.data.pipe(writer);

        await new Promise((resolve, reject) => {
          writer.on('finish', resolve);
          writer.on('error', reject);
        });

        await new Promise((resolve, reject) => {
          ffmpeg(tempIn)
            .setStartTime(0)
            .setDuration(5)
            .complexFilter([
              'fps=10,scale=360:-1:flags=lanczos,split[s0][s1]',
              '[s0]palettegen=stats_mode=diff[p]',
              '[s1][p]paletteuse=dither=bayer:bayer_scale=2'
            ])
            .toFormat('gif')
            .on('end', resolve)
            .on('error', reject)
            .save(tempOut);
        });

        gifBuffer = fs.readFileSync(tempOut);
        if (fs.existsSync(tempIn)) fs.unlinkSync(tempIn);
        if (fs.existsSync(tempOut)) fs.unlinkSync(tempOut);
      }

      if (gifBuffer.length > 10 * 1024 * 1024) {
        throw new Error('The converted GIF is larger than 10 MB. Try a shorter or smaller source.');
      }

      const attachment = new AttachmentBuilder(gifBuffer, { name: 'converted.gif' });
      const resultEmbed = new EmbedBuilder()
        .setColor(colors.utility)
        .setTitle('GIF Ready')
        .addFields(
          { name: 'Source', value: isImage ? 'Image' : 'Video', inline: true },
          { name: 'Output', value: `${(gifBuffer.length / 1024 / 1024).toFixed(2)} MB`, inline: true },
        )
        .setFooter({ text: isVideo ? 'First 5 seconds • 360 px • 10 fps' : 'Static GIF • up to 480 px' })
        .setTimestamp();
      
      // Auto-upload logic
      if (autoUpload) {
        try {
          await interaction.editReply({ content: '📤 Automatically uploading to cloud...', files: [] });
          
          const result = await uploadFile(gifBuffer, 'converted.gif', 'image/gif');
          return await interaction.editReply({
            embeds: [new EmbedBuilder().setColor(colors.utility).setTitle('Upload complete').setDescription(`[Open GIF](${result.imageUrl})`).setTimestamp()],
            files: [],
            components: []
          });
        } catch (uploadErr) {
          console.error('[TOGIF] Auto-upload error:', uploadErr.message);
          return await interaction.editReply({ content: `❌ Auto-upload error: ${uploadErr.message}`, files: [attachment] });
        }
      }

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('upload_ez')
          .setLabel('☁️ Upload to Cloud')
          .setStyle(ButtonStyle.Primary)
      );

      const response = await interaction.editReply({
        embeds: [resultEmbed],
        files: [attachment],
        components: [row]
      });

      // Collector for the Upload button
      const collector = response.createMessageComponentCollector({
        componentType: ComponentType.Button,
        time: 300000 // 5 minutes
      });

      collector.on('collect', async (i) => {
        if (i.customId === 'upload_ez') {
          if (i.user.id !== interaction.user.id) {
            return i.reply({ content: 'Run `/togif` yourself to upload a GIF.', flags: 64 });
          }

          await i.deferUpdate();

          try {
            const result = await uploadFile(gifBuffer, 'converted.gif', 'image/gif');
            await i.editReply({
              embeds: [new EmbedBuilder().setColor(colors.utility).setTitle('Upload complete').setDescription(`[Open GIF](${result.imageUrl})`).setTimestamp()],
              files: [],
              components: []
            });
          } catch (uploadErr) {
            console.error('[TOGIF] Upload error:', uploadErr.message);
            await i.editReply({ content: `❌ Error uploading to cloud: ${uploadErr.message}`, components: [] });
          }
        }
      });

      collector.on('end', async () => {
        await interaction.editReply({ components: [] }).catch(() => {});
      });

    } catch (err) {
      console.error('[TOGIF] Error:', err);
      await interaction.editReply(`❌ Failed to convert: ${err.message}`);
    } finally {
      removeFile(tempIn);
      removeFile(tempOut);
    }
  },
};

function removeFile(file) {
  try { if (file && fs.existsSync(file)) fs.unlinkSync(file); } catch { }
}
