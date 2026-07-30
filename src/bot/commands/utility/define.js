const axios = require('axios');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, SlashCommandBuilder } = require('discord.js');
const { colors } = require('../../../utils/constants');

const truncate = (value, max = 1024) => value.length > max ? `${value.slice(0, max - 3)}...` : value;

async function fetchDefinition(word) {
  const response = await axios.get(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`, {
    timeout: 10000,
    validateStatus: status => status === 200 || status === 404,
  });
  if (response.status === 404) return null;
  return response.data?.[0] || null;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('define')
    .setDescription('Look up an English word, pronunciation, examples, and synonyms')
    .addStringOption(o => o.setName('word').setDescription('English word to define').setRequired(true).setMaxLength(100))
    .addBooleanOption(o => o.setName('quiet').setDescription('Make the response only visible to you')),

  async execute(interaction) {
    const word = interaction.options.getString('word', true).trim();
    const quiet = interaction.options.getBoolean('quiet') ?? false;
    if (!/^[a-zA-Z][a-zA-Z '\-]*$/.test(word)) {
      return interaction.reply({ content: 'Enter an English word or phrase using letters only.', flags: 64 });
    }
    await interaction.deferReply({ flags: quiet ? 64 : undefined });
    try {
      const entry = await fetchDefinition(word);
      if (!entry) return interaction.editReply(`I could not find an English definition for **${word}**.`);

      const meanings = (entry.meanings || []).slice(0, 4);
      const fields = meanings.map(meaning => {
        const definitions = (meaning.definitions || []).slice(0, 3).map((item, index) => {
          const example = item.example ? `\n*“${truncate(item.example, 240)}”*` : '';
          return `**${index + 1}.** ${truncate(item.definition || 'No definition available.', 550)}${example}`;
        });
        const synonyms = [...new Set([...(meaning.synonyms || []), ...(meaning.definitions || []).flatMap(d => d.synonyms || [])])].slice(0, 8);
        if (synonyms.length) definitions.push(`**Synonyms:** ${synonyms.join(', ')}`);
        return { name: meaning.partOfSpeech || 'Meaning', value: truncate(definitions.join('\n'), 1024) || 'No definition available.' };
      });

      const phonetic = entry.phonetic || (entry.phonetics || []).find(p => p.text)?.text;
      const audio = (entry.phonetics || []).find(p => /^https:\/\//.test(p.audio || ''))?.audio;
      const embed = new EmbedBuilder()
        .setColor(colors.utility)
        .setTitle(entry.word || word)
        .setDescription(phonetic ? `Pronunciation: **${phonetic}**` : 'English dictionary definition')
        .addFields(fields.length ? fields : [{ name: 'Definition', value: 'No definitions were returned.' }])
        .setFooter({ text: 'Dictionary data from Free Dictionary API' })
        .setTimestamp();
      const components = audio ? [new ActionRowBuilder().addComponents(
        new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Hear pronunciation').setURL(audio)
      )] : [];
      return interaction.editReply({ embeds: [embed], components });
    } catch (error) {
      return interaction.editReply(`Dictionary lookup failed: ${truncate(error.message || String(error), 300)}`);
    }
  },

  fetchDefinition,
};
