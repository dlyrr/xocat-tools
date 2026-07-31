// /cat — Random cat images
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const axios = require('axios');
const { colors } = require('../../../utils/constants');

module.exports = {
  prefixGreedy: 'text',
  prefixAliases: ['kitty', 'kitten', 'cats'],
  data: new SlashCommandBuilder()
    .setName('cat')
    .setDescription('Get random cat content')
    .addSubcommand(s => s.setName('gif').setDescription('Get a random cat GIF').addBooleanOption(
    o => o.setName("quiet").setDescription("Make the response only visible to you").setRequired(false)
  ))
    .addSubcommand(s => s.setName('text').setDescription('Get a random cat image saying custom text').addStringOption(o => o.setName('text').setDescription('Text for the cat to say').setRequired(true).setMaxLength(200)).addBooleanOption(
    o => o.setName("quiet").setDescription("Make the response only visible to you").setRequired(false)
  )),
  async execute(interaction) {
    const quiet = interaction.options.getBoolean("quiet") ?? false;
    await interaction.deferReply({
      flags: quiet ? 64 : undefined
    });
    const sub = interaction.options.getSubcommand();
    try {
      if (sub === 'gif') {
        const apiKey = process.env.CAT_API_KEY;
        const headers = apiKey ? { 'x-api-key': apiKey } : {};
        const { data } = await axios.get('https://api.thecatapi.com/v1/images/search', { params: { mime_types: 'gif', limit: 1 }, headers, timeout: 10000 });
        const imageUrl = data[0]?.url;
        if (!imageUrl) throw new Error('The Cat API did not return an image.');
      const embed = new EmbedBuilder().setColor(colors.fun).setTitle('Random cat GIF').setImage(imageUrl)
          .setFooter({ text: 'The Cat API • random GIF' }).setTimestamp();
        await interaction.editReply({ embeds: [embed] });
      } else {
        const text = interaction.options.getString('text');
        const encoded = encodeURIComponent(text);
        const { data } = await axios.get(`https://cataas.com/cat/says/${encoded}.jpg?fontSize=40&fontColor=white`, { timeout: 10000 });
        if (!data?.url) throw new Error('Cataas did not return an image.');
      const embed = new EmbedBuilder().setColor(colors.fun).setTitle('Cat says...').setImage(data.url)
          .setFooter({ text: 'Cataas • generated image' }).setTimestamp();
        await interaction.editReply({ embeds: [embed] });
      }
    } catch (err) {
      await interaction.editReply({ content: `❌ Failed to fetch cat: ${err.message}` });
    }
  },
};

