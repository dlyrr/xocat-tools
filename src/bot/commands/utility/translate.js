const axios = require('axios');
const { EmbedBuilder, SlashCommandBuilder } = require('discord.js');
const { colors } = require('../../../utils/constants');

const LANGUAGES = [
  ['auto', 'Auto-detect'],
  ['af', 'Afrikaans'],
  ['ar', 'Arabic'],
  ['bn', 'Bengali'],
  ['zh-CN', 'Chinese (Simplified)'],
  ['zh-TW', 'Chinese (Traditional)'],
  ['cs', 'Czech'],
  ['da', 'Danish'],
  ['nl', 'Dutch'],
  ['en', 'English'],
  ['fi', 'Finnish'],
  ['fr', 'French'],
  ['de', 'German'],
  ['el', 'Greek'],
  ['he', 'Hebrew'],
  ['hi', 'Hindi'],
  ['hu', 'Hungarian'],
  ['id', 'Indonesian'],
  ['it', 'Italian'],
  ['ja', 'Japanese'],
  ['ko', 'Korean'],
  ['no', 'Norwegian'],
  ['fa', 'Persian'],
  ['pl', 'Polish'],
  ['pt', 'Portuguese'],
  ['ro', 'Romanian'],
  ['ru', 'Russian'],
  ['es', 'Spanish'],
  ['sv', 'Swedish'],
  ['th', 'Thai'],
  ['tr', 'Turkish'],
  ['uk', 'Ukrainian'],
  ['ur', 'Urdu'],
  ['vi', 'Vietnamese'],
];

const languageNames = new Map(LANGUAGES);

function truncate(value, limit = 1024) {
  return value.length <= limit ? value : `${value.slice(0, limit - 3)}...`;
}

async function translateText(text, targetLanguage, sourceLanguage = 'auto') {
  const { data } = await axios.get('https://translate.googleapis.com/translate_a/single', {
    params: {
      client: 'gtx',
      sl: sourceLanguage,
      tl: targetLanguage,
      dt: 't',
      q: text,
    },
    timeout: 12000,
  });

  const translated = Array.isArray(data?.[0])
    ? data[0].map(segment => segment?.[0] || '').join('').trim()
    : '';
  if (!translated) throw new Error('The translation service returned an empty response.');

  return {
    translated,
    detectedLanguage: typeof data?.[2] === 'string' ? data[2] : sourceLanguage,
  };
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('translate')
    .setDescription('Translate text or detect its language')
    .addSubcommand(subcommand => subcommand
      .setName('text')
      .setDescription('Translate text into another language')
      .addStringOption(option => option
        .setName('text')
        .setDescription('Text to translate')
        .setRequired(true)
        .setMaxLength(1000))
      .addStringOption(option => option
        .setName('to')
        .setDescription('Language to translate into')
        .setRequired(true)
        .setAutocomplete(true))
      .addStringOption(option => option
        .setName('from')
        .setDescription('Source language (defaults to auto-detect)')
        .setRequired(false)
        .setAutocomplete(true))
      .addBooleanOption(option => option
        .setName('quiet')
        .setDescription('Make the response only visible to you')
        .setRequired(false)))
    .addSubcommand(subcommand => subcommand
      .setName('detect')
      .setDescription('Detect the language of some text without translating it')
      .addStringOption(option => option
        .setName('text')
        .setDescription('Text whose language should be detected')
        .setRequired(true)
        .setMaxLength(1000))
      .addBooleanOption(option => option
        .setName('quiet')
        .setDescription('Make the response only visible to you')
        .setRequired(false))),

  async autocomplete(interaction) {
    const focused = interaction.options.getFocused(true);
    const query = String(focused.value || '').toLowerCase();
    const choices = LANGUAGES
      .filter(([code]) => focused.name === 'from' || code !== 'auto')
      .filter(([code, name]) => !query || code.toLowerCase().includes(query) || name.toLowerCase().includes(query))
      .slice(0, 25)
      .map(([value, name]) => ({ name, value }));
    await interaction.respond(choices);
  },

  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();
    const text = interaction.options.getString('text', true).trim();
    const targetLanguage = subcommand === 'detect' ? 'en' : interaction.options.getString('to', true);
    const sourceLanguage = interaction.options.getString('from') || 'auto';
    const quiet = interaction.options.getBoolean('quiet') ?? false;

    if (!text) {
      return interaction.reply({ content: 'Please provide some text to translate.', flags: 64 });
    }
    if (subcommand === 'text' && (!languageNames.has(targetLanguage) || targetLanguage === 'auto')) {
      return interaction.reply({ content: 'Choose a valid target language from autocomplete.', flags: 64 });
    }
    if (!languageNames.has(sourceLanguage)) {
      return interaction.reply({ content: 'Choose a valid source language from autocomplete.', flags: 64 });
    }

    await interaction.deferReply({ flags: quiet ? 64 : undefined });

    try {
      const result = await translateText(text, targetLanguage, sourceLanguage);
      const detectedCode = result.detectedLanguage;
      const sourceName = languageNames.get(detectedCode) || detectedCode.toUpperCase();
      if (subcommand === 'detect') {
        const embed = new EmbedBuilder()
          .setColor(colors.utility)
          .setTitle('Language detected')
          .setDescription(truncate(text, 2000))
          .addFields(
            { name: 'Language', value: sourceName, inline: true },
            { name: 'Language code', value: `\`${detectedCode}\``, inline: true }
          )
          .setFooter({ text: 'Detection works best with complete sentences' });
        return interaction.editReply({ embeds: [embed] });
      }
      const targetName = languageNames.get(targetLanguage);
      const embed = new EmbedBuilder()
        .setColor(colors.utility)
        .setTitle('Translation')
        .addFields(
          { name: sourceName, value: truncate(text) },
          { name: targetName, value: truncate(result.translated) }
        )
        .setFooter({ text: `${sourceName} → ${targetName}` });

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      await interaction.editReply(`Could not translate that text: ${truncate(String(error.message || error), 400)}`);
    }
  },

  LANGUAGES,
  translateText,
};
