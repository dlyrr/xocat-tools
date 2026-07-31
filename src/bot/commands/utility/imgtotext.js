const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { colors } = require('../../../utils/constants');
const Tesseract = require('tesseract.js');
const { MediaNotFoundError, requireMedia } = require('../../../services/mediaResolver');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('imgtotext')
    .setDescription('Extract text from an image using OCR')
    .addAttachmentOption(o => o.setName('image').setDescription('The image to read (defaults to the most recent one in the channel)').setRequired(false))
    .addStringOption(o => o.setName('link').setDescription('An image URL, custom emoji, or user ID to read instead of an attachment').setRequired(false).setMaxLength(500))
    .addUserOption(o => o.setName('user').setDescription("Read text from this user's avatar").setRequired(false))
    .addBooleanOption(o => o.setName('quiet').setDescription('Make the response only visible to you').setRequired(false)),

  prefixAliases: ['ocr', 'readtext'],

  async execute(interaction) {
    const quiet = interaction.options.getBoolean('quiet') ?? false;
    await interaction.deferReply({ flags: quiet ? 64 : undefined });

    let attachment;
    try {
      attachment = await requireMedia(interaction, {
        attachmentOption: 'image',
        noMediaMessage: 'I could not find an image to read. Attach one, reply to a message with one, paste a link, or mention a user to use their avatar.',
      });
    } catch (error) {
      if (error instanceof MediaNotFoundError) return interaction.editReply(`❌ ${error.message}`);
      throw error;
    }

    try {
      await interaction.editReply('🔍 Reading image text (this might take a few seconds)...');

      const { createWorker } = require('tesseract.js');
      const worker = await createWorker('eng', 1, {
        logger: m => console.log(`[OCR] ${m.status}: ${Math.round(m.progress * 100)}%`)
      });

      let text = '';
      try {
        const result = await worker.recognize(attachment.url);
        text = result.data.text;
      } finally {
        await worker.terminate();
      }

      if (!text || text.trim().length === 0) {
        return interaction.editReply({ content: '⚠️ No text could be extracted from this image.', embeds: [] });
      }

      // Handle message length limits (2000 chars)
      if (text.length > 2000) {
        const truncated = text.slice(0, 1900).replace(/```/g, "'''") + '... (truncated)';
        const embed = new EmbedBuilder()
          .setColor(colors.utility)
          .setTitle('Extracted text')
          .setDescription(`\`\`\`\n${truncated}\n\`\`\``)
          .setFooter({ text: 'The extracted text was too long and has been truncated.' })
          .setTimestamp();
        
        return interaction.editReply({ content: '', embeds: [embed] });
      }

      const safeText = text.replace(/```/g, "'''");
      const embed = new EmbedBuilder()
        .setColor(colors.utility)
        .setTitle('Extracted text')
        .setDescription(`\`\`\`\n${safeText}\n\`\`\``)
        .setTimestamp();

      await interaction.editReply({ content: '', embeds: [embed] });

    } catch (err) {
      console.error('[OCR] Error:', err);
      await interaction.editReply({ content: `❌ OCR Error: ${err.message}`, embeds: [] });
    }
  },
};
