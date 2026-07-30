const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { colors } = require('../../../utils/constants');
const roblox = require('../../../services/robloxService');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('robloxserver')
    .setDescription('Roblox place information')
    .addSubcommand(s => s
      .setName('details')
      .setDescription('Show current place stats from Roblox')
      .addStringOption(o => o.setName('placeid').setDescription('Place ID').setRequired(true))
      .addBooleanOption(o => o.setName('quiet').setDescription('Make the response only visible to you').setRequired(false))),

  async execute(interaction) {
    const quiet = interaction.options.getBoolean('quiet') ?? false;
    const placeId = interaction.options.getString('placeid');
    await interaction.deferReply({ flags: quiet ? 64 : undefined });

    try {
      if (!/^\d+$/.test(placeId)) throw new Error('Place ID must contain only numbers.');
      const universe = await roblox.getUniverseFromPlace(placeId);
      const [game] = await roblox.getGameDetails(universe.universeId);
      if (!game) return interaction.editReply({ content: '❌ Game not found.' });

      const embed = new EmbedBuilder()
        .setColor(colors.roblox)
        .setTitle(game.name)
        .setURL(`https://www.roblox.com/games/${placeId}`)
        .setDescription(game.description?.slice(0, 300) || 'No description')
        .addFields(
          { name: 'Playing', value: Number(game.playing || 0).toLocaleString(), inline: true },
          { name: 'Visits', value: Number(game.visits || 0).toLocaleString(), inline: true },
          { name: 'Favorites', value: Number(game.favoritedCount || 0).toLocaleString(), inline: true },
          { name: 'Max Players', value: game.maxPlayers ? String(game.maxPlayers) : 'N/A', inline: true },
          { name: 'Created', value: formatTimestamp(game.created, 'D'), inline: true },
          { name: 'Updated', value: formatTimestamp(game.updated, 'R'), inline: true },
        )
        .setFooter({ text: `Roblox live data • Place ${placeId}` })
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      await interaction.editReply({ content: `❌ Error: ${error.message}` });
    }
  },
};

function formatTimestamp(value, style) {
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? `<t:${Math.floor(timestamp / 1000)}:${style}>` : 'N/A';
}
