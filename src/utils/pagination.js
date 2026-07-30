// ============================================================
// Button-Based Pagination Utility
// ============================================================
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType } = require('discord.js');
const { pagination: paginationConfig } = require('./constants');

/**
 * Create a paginated embed response
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 * @param {import('discord.js').EmbedBuilder[]} pages - Array of embeds (one per page)
 * @param {number} timeout - Timeout in ms
 */
async function paginate(interaction, pages, timeout = paginationConfig.timeout) {
  if (pages.length === 0) return;

  if (pages.length === 1) {
    return interaction.editReply({ embeds: [pages[0]] });
  }

  let currentPage = 0;

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('pagination_first')
      .setEmoji('⏪')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(true),
    new ButtonBuilder()
      .setCustomId('pagination_prev')
      .setEmoji('◀️')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(true),
    new ButtonBuilder()
      .setCustomId('pagination_counter')
      .setLabel(`1 / ${pages.length}`)
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(true),
    new ButtonBuilder()
      .setCustomId('pagination_next')
      .setEmoji('▶️')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(pages.length <= 1),
    new ButtonBuilder()
      .setCustomId('pagination_last')
      .setEmoji('⏩')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(pages.length <= 1),
  );

  const message = await interaction.editReply({
    embeds: [pages[0]],
    components: [row],
  });

  const collector = message.createMessageComponentCollector({
    componentType: ComponentType.Button,
    time: timeout,
    filter: (i) => i.user.id === interaction.user.id,
  });

  collector.on('collect', async (i) => {
    switch (i.customId) {
      case 'pagination_first':
        currentPage = 0;
        break;
      case 'pagination_prev':
        currentPage = Math.max(0, currentPage - 1);
        break;
      case 'pagination_next':
        currentPage = Math.min(pages.length - 1, currentPage + 1);
        break;
      case 'pagination_last':
        currentPage = pages.length - 1;
        break;
    }

    row.components[0].setDisabled(currentPage === 0);
    row.components[1].setDisabled(currentPage === 0);
    row.components[2].setLabel(`${currentPage + 1} / ${pages.length}`);
    row.components[3].setDisabled(currentPage === pages.length - 1);
    row.components[4].setDisabled(currentPage === pages.length - 1);

    await i.update({
      embeds: [pages[currentPage]],
      components: [row],
    });
  });

  collector.on('end', async () => {
    row.components.forEach((btn) => btn.setDisabled(true));
    await message.edit({ components: [row] }).catch(() => {});
  });
}

module.exports = { paginate };
