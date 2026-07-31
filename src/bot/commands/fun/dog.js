// ============================================================
// /dog — random dog pictures
// ============================================================
const axios = require('axios');
const { EmbedBuilder, SlashCommandBuilder } = require('discord.js');
const { colors } = require('../../../utils/constants');

const RANDOM_ENDPOINT = 'https://dog.ceo/api/breeds/image/random';
const BREED_ENDPOINT = breed => `https://dog.ceo/api/breed/${encodeURIComponent(breed)}/images/random`;
const BREED_LIST = 'https://dog.ceo/api/breeds/list/all';

/** dog.ceo encodes the breed in the image path, e.g. /breeds/hound-afghan/… */
function breedFromUrl(url) {
  const match = /\/breeds\/([^/]+)\//.exec(url || '');
  if (!match) return null;
  return match[1]
    .split('-')
    .reverse()
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('dog')
    .setDescription('Get a random dog picture')
    .addStringOption(o => o
      .setName('breed')
      .setDescription('Ask for a specific breed (e.g. corgi, husky, shiba)')
      .setRequired(false)
      .setAutocomplete(true))
    .addBooleanOption(o => o.setName('quiet').setDescription('Make the response only visible to you').setRequired(false)),

  prefixAliases: ['doggo', 'doggos', 'dogs', 'pupper', 'puppers', 'puppy', 'pup'],

  async autocomplete(interaction) {
    const query = interaction.options.getFocused().toLowerCase().trim();
    try {
      const { data } = await axios.get(BREED_LIST, { timeout: 5000 });
      const breeds = Object.keys(data?.message || {});
      const matches = query ? breeds.filter(breed => breed.includes(query)) : breeds;
      await interaction.respond(matches.slice(0, 25).map(breed => ({ name: breed, value: breed })));
    } catch {
      await interaction.respond([]);
    }
  },

  async execute(interaction) {
    const quiet = interaction.options.getBoolean('quiet') ?? false;
    const breed = interaction.options.getString('breed')?.trim().toLowerCase();

    await interaction.deferReply({ flags: quiet ? 64 : undefined });

    try {
      const { data } = await axios.get(breed ? BREED_ENDPOINT(breed) : RANDOM_ENDPOINT, { timeout: 15000 });
      const imageUrl = data?.message;
      if (data?.status !== 'success' || typeof imageUrl !== 'string') {
        throw new Error(breed ? `\`${breed}\` is not a breed dog.ceo knows about.` : 'dog.ceo did not return an image.');
      }

      const embed = new EmbedBuilder()
        .setColor(colors.fun)
        .setTitle(breedFromUrl(imageUrl) || 'Random dog')
        .setImage(imageUrl)
        .setFooter({ text: 'dog.ceo' })
        .setTimestamp();

      return interaction.editReply({ embeds: [embed] });
    } catch (error) {
      return interaction.editReply(`❌ Could not fetch a dog: ${error.message}`);
    }
  },
};
