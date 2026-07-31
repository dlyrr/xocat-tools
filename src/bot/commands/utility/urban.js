const axios = require('axios');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, SlashCommandBuilder } = require('discord.js');
const { colors } = require('../../../utils/constants');

const clean = value => String(value || '').replace(/\[([^\]]+)]/g, '$1').trim();
const truncate = (value, max = 1024) => value.length > max ? `${value.slice(0, max - 3)}...` : value;

async function fetchUrban(term) {
  const { data } = await axios.get('https://api.urbandictionary.com/v0/define', {
    params: { term },
    timeout: 10000,
  });
  return (data?.list || []).sort((a, b) => (b.thumbs_up - b.thumbs_down) - (a.thumbs_up - a.thumbs_down));
}

module.exports = {
  prefixGreedy: 'term',
  prefixAliases: ['ud', 'urbandictionary'],
  data: new SlashCommandBuilder()
    .setName('urban')
    .setDescription('Search Urban Dictionary for slang definitions')
    .addStringOption(o => o.setName('term').setDescription('Slang word or phrase').setRequired(true).setMaxLength(100))
    .addBooleanOption(o => o.setName('quiet').setDescription('Make the response only visible to you')),

  async execute(interaction) {
    const term = interaction.options.getString('term', true).trim();
    const quiet = interaction.options.getBoolean('quiet') ?? false;
    if (!term) return interaction.reply({ content: 'Enter a term to search for.', flags: 64 });
    await interaction.deferReply({ flags: quiet ? 64 : undefined });
    try {
      const [result] = await fetchUrban(term);
      if (!result) return interaction.editReply(`Urban Dictionary has no definitions for **${term}**.`);
      const embed = new EmbedBuilder()
        .setColor(colors.social)
        .setTitle(truncate(clean(result.word) || term, 256))
        .setURL(result.permalink)
        .setDescription(truncate(clean(result.definition), 3500))
        .addFields(
          { name: 'Example', value: truncate(clean(result.example) || 'No example provided.') },
          { name: 'Community rating', value: `👍 ${Number(result.thumbs_up || 0).toLocaleString()}  ·  👎 ${Number(result.thumbs_down || 0).toLocaleString()}`, inline: true },
          { name: 'Submitted by', value: truncate(result.author || 'Unknown', 100), inline: true },
        )
        .setFooter({ text: 'Community-submitted content may be inaccurate or offensive' });
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Open on Urban Dictionary').setURL(result.permalink)
      );
      return interaction.editReply({ embeds: [embed], components: [row] });
    } catch (error) {
      return interaction.editReply(`Urban Dictionary lookup failed: ${truncate(error.message || String(error), 300)}`);
    }
  },

  fetchUrban,
};
