const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { colors } = require('../../../utils/constants');
const Tesseract = require('tesseract.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('imgtotext')
    .setDescription('Extract text from an image using OCR')
    .addAttachmentOption(o => o.setName('image').setDescription('The image to extract text from').setRequired(true))
    .addBooleanOption(o => o.setName('quiet').setDescription('Make the response only visible to you').setRequired(false)),

  async execute(interaction) {
    const quiet = interaction.options.getBoolean('quiet') ?? false;
    await interaction.deferReply({ flags: quiet ? 64 : undefined });

    const attachment = interaction.options.getAttachment('image');

    if (!attachment.contentType?.startsWith('image/')) {
      return interaction.editReply('❌ Please upload a valid image file!');
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
