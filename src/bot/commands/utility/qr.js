const axios = require('axios');
const FormData = require('form-data');
const { AttachmentBuilder, EmbedBuilder, SlashCommandBuilder } = require('discord.js');
const { colors } = require('../../../utils/constants');

const MAX_IMAGE_SIZE = 8 * 1024 * 1024;
const truncate = (value, max = 1000) => value.length > max ? `${value.slice(0, max - 3)}...` : value;

async function generateQr(text, size = 500) {
  const { data } = await axios.get('https://api.qrserver.com/v1/create-qr-code/', {
    params: { size: `${size}x${size}`, data: text, format: 'png', margin: 16 },
    responseType: 'arraybuffer',
    timeout: 15000,
    maxContentLength: 2 * 1024 * 1024,
  });
  return Buffer.from(data);
}

async function decodeQr(fileUrl) {
  const imageResponse = await axios.get(fileUrl, {
    responseType: 'arraybuffer',
    timeout: 15000,
    maxContentLength: MAX_IMAGE_SIZE,
    maxBodyLength: MAX_IMAGE_SIZE,
  });
  const contentType = String(imageResponse.headers['content-type'] || 'image/png').split(';')[0];
  if (!contentType.startsWith('image/')) throw new Error('The attachment did not contain an image.');
  const form = new FormData();
  form.append('file', Buffer.from(imageResponse.data), { filename: 'qr-image', contentType });
  const { data } = await axios.post('https://api.qrserver.com/v1/read-qr-code/', form, {
    headers: form.getHeaders(),
    timeout: 15000,
    maxBodyLength: MAX_IMAGE_SIZE + 1024,
  });
  const symbol = data?.[0]?.symbol?.[0];
  if (!symbol || symbol.error) throw new Error(symbol?.error || 'No QR code was found in that image.');
  return symbol.data;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('qr')
    .setDescription('Generate or decode QR codes')
    .addSubcommand(sub => sub.setName('generate').setDescription('Generate a QR code from text or a URL')
      .addStringOption(o => o.setName('text').setDescription('Text or URL to encode').setRequired(true).setMaxLength(1500))
      .addBooleanOption(o => o.setName('quiet').setDescription('Make the response only visible to you')))
    .addSubcommand(sub => sub.setName('decode').setDescription('Read a QR code from an uploaded image')
      .addAttachmentOption(o => o.setName('image').setDescription('PNG, JPEG, WebP, or GIF image').setRequired(true))
      .addBooleanOption(o => o.setName('quiet').setDescription('Make the response only visible to you'))),

  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();
    const quiet = interaction.options.getBoolean('quiet') ?? false;
    await interaction.deferReply({ flags: quiet ? 64 : undefined });
    try {
      if (subcommand === 'generate') {
        const text = interaction.options.getString('text', true).trim();
        if (!text) return interaction.editReply('Enter text or a URL to encode.');
        const file = new AttachmentBuilder(await generateQr(text), { name: 'qr-code.png' });
        const embed = new EmbedBuilder()
          .setColor(colors.utility)
          .setTitle('QR code generated')
          .setDescription(truncate(text, 500))
          .setImage('attachment://qr-code.png')
          .setFooter({ text: 'Scan carefully—always verify links before opening them' });
        return interaction.editReply({ embeds: [embed], files: [file] });
      }
      const image = interaction.options.getAttachment('image', true);
      if (image.size > MAX_IMAGE_SIZE) return interaction.editReply('That image is larger than 8 MB.');
      if (!image.contentType?.startsWith('image/')) return interaction.editReply('Upload a PNG, JPEG, WebP, or GIF image.');
      const result = await decodeQr(image.url);
      if (!result) return interaction.editReply('The QR code contained no readable text.');
      const embed = new EmbedBuilder()
        .setColor(colors.utility)
        .setTitle('QR code decoded')
        .setDescription(truncate(result, 4000))
        .setThumbnail(image.url)
        .setFooter({ text: 'Treat decoded links as untrusted until you verify them' });
      return interaction.editReply({ embeds: [embed] });
    } catch (error) {
      return interaction.editReply(`QR operation failed: ${truncate(error.message || String(error), 300)}`);
    }
  },

  generateQr,
  decodeQr,
};
