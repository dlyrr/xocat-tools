// ============================================================
// Event: interactionCreate
// ============================================================
const { errorEmbed, premiumEmbed } = require('../../utils/embeds');
const { isPremium } = require('../../utils/premium');
const { incrementCommandUsage } = require('../../database/db');
const { handlePollButton } = require('../../services/pollService');

module.exports = {
  name: 'interactionCreate',
  once: false,
  async execute(interaction) {
    // Handle slash commands
    if (interaction.isChatInputCommand()) {
      const command = interaction.client.commands.get(interaction.commandName);

      if (!command) {
        return interaction.reply({
          embeds: [errorEmbed('Unknown Command', 'This command does not exist.')],
          flags: 64,
        });
      }

      // Premium requirement removed

      try {
        // Let the command acknowledge Discord's three-second interaction
        // deadline before synchronous analytics writes touch the database.
        await command.execute(interaction);

        if (!command.skipUsageTracking) {
          const subcommandGroup = interaction.options.getSubcommandGroup(false);
          const subcommand = interaction.options.getSubcommand(false);
          let fullCommand = `/${interaction.commandName}`;
          if (subcommandGroup) fullCommand += ` ${subcommandGroup}`;
          if (subcommand) fullCommand += ` ${subcommand}`;
          try {
            incrementCommandUsage(interaction.user.id, fullCommand, interaction.guildId);
          } catch (error) {
            console.error(`[ANALYTICS] Could not record ${fullCommand}:`, error);
          }
        }
      } catch (error) {
        console.error(`[ERROR] Command /${interaction.commandName}:`, error);
        const detail = String(error?.message || error || 'Unknown error')
          .replace(/```/g, "''' ")
          .slice(0, 3500);
        const errorResponse = {
          embeds: [errorEmbed('Command Error', `Something went wrong:\n\`\`\`${detail}\`\`\``)],
          flags: 64,
        };

        if (interaction.deferred && !interaction.replied) {
          // Complete the original deferred response instead of leaving the user
          // staring at "thinking" while an unrelated follow-up is sent.
          const { flags, ...editResponse } = errorResponse;
          await interaction.editReply(editResponse).catch(() => {});
        } else if (interaction.replied) {
          await interaction.followUp(errorResponse).catch(() => {});
        } else {
          await interaction.reply(errorResponse).catch(() => {});
        }
      }
    }

    // Handle button interactions
    if (interaction.isButton()) {
      if (await handlePollButton(interaction)) return;
      if (interaction.customId.startsWith('game_')) return;
    }

    // Handle autocomplete
    if (interaction.isAutocomplete()) {
      const command = interaction.client.commands.get(interaction.commandName);
      if (command && command.autocomplete) {
        try {
          await command.autocomplete(interaction);
        } catch (error) {
          console.error(`[ERROR] Autocomplete /${interaction.commandName}:`, error);
        }
      }
    }
  },
};
