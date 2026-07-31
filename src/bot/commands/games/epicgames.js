// /epicgames — Epic Games Store free games
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { colors } = require('../../../utils/constants');
const axios = require('axios');

module.exports = {
  prefixAliases: ['epic', 'freegames'],
  data: new SlashCommandBuilder()
    .setName('epicgames')
    .setDescription('Epic Games Store commands')
    .addSubcommand(s => s.setName('free').setDescription('Browse games that are free on Epic right now').addBooleanOption(
    o => o.setName("quiet").setDescription("Make the response only visible to you").setRequired(false)
  ))
    .addSubcommand(s => s.setName('upcoming').setDescription('Browse upcoming free Epic Games Store games').addBooleanOption(
    o => o.setName("quiet").setDescription("Make the response only visible to you").setRequired(false)
  )),
  async execute(interaction) {
    const quiet = interaction.options.getBoolean("quiet") ?? false;
    await interaction.deferReply({
      flags: quiet ? 64 : undefined
    });
    try {
      // Use the Epic Games Store promotion API
      const { data } = await axios.get('https://store-site-backend-static.ak.epicgames.com/freeGamesPromotions?locale=en-US&country=US&allowCountries=US', { timeout: 10000 });
      const games = data?.data?.Catalog?.searchStore?.elements || [];

      const currentFree = [];
      const upcoming = [];

      for (const game of games) {
        const promos = game.promotions?.promotionalOffers?.[0]?.promotionalOffers || [];
        const upcomingPromos = game.promotions?.upcomingPromotionalOffers?.[0]?.promotionalOffers || [];

        if (promos.length > 0 && promos.some(p => p.discountSetting?.discountPercentage === 0)) {
          currentFree.push(game);
        }
        if (upcomingPromos.length > 0) {
          upcoming.push(game);
        }
      }

      const sub = interaction.options.getSubcommand();
      const list = sub === 'free' ? currentFree : upcoming;
      const title = sub === 'free' ? 'Free games now' : 'Upcoming free games';

      if (!list.length) {
        const embed = new EmbedBuilder().setColor(colors.accent).setTitle(title)
          .setDescription('No matching promotions are listed for the US store right now.')
          .setFooter({ text: 'Epic Games Store • US region' })
          .setTimestamp();
        return interaction.editReply({ embeds: [embed] });
      }

      const desc = list.slice(0, 5).map(g => {
        const price = g.price?.totalPrice?.fmtPrice?.originalPrice || 'Free';
        const offers = sub === 'free'
          ? g.promotions?.promotionalOffers?.[0]?.promotionalOffers
          : g.promotions?.upcomingPromotionalOffers?.[0]?.promotionalOffers;
        const offer = offers?.[0];
        const period = offer?.startDate && offer?.endDate
          ? `<t:${Math.floor(new Date(offer.startDate).getTime() / 1000)}:d> → <t:${Math.floor(new Date(offer.endDate).getTime() / 1000)}:d>`
          : 'Dates unavailable';
        return `**${g.title}**\n${price} • ${period}\n${g.description?.slice(0, 110) || 'No description available.'}`;
      }).join('\n\n');

      const thumbnail = list[0]?.keyImages?.find(i => i.type === 'Thumbnail' || i.type === 'OfferImageWide')?.url;
      const embed = new EmbedBuilder().setColor(colors.accent).setTitle(title).setDescription(desc)
        .setFooter({ text: 'Epic Games Store • US region • live promotion data' });
      if (thumbnail) embed.setThumbnail(thumbnail);
      embed.setTimestamp();
      await interaction.editReply({ embeds: [embed] });
    } catch (err) {
      await interaction.editReply({ content: `❌ Error fetching Epic Games data: ${err.message}` });
    }
  },
};

