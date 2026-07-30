const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder } = require('discord.js');
const { colors } = require('../../../utils/constants');
const fs = require('fs');
const path = require('path');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('help')
    .setDescription('List all commands or get help for a category')
    .addStringOption(o => o
      .setName('category')
      .setDescription('The category to view')
      .setRequired(false)
      .addChoices(
        { name: 'Utility', value: 'utility' },
        { name: 'Integrations', value: 'integrations' },
        { name: 'Games', value: 'games' },
        { name: 'Fun', value: 'fun' },
        { name: 'Roblox', value: 'roblox' },
        { name: 'Social', value: 'social' },
        { name: 'Finance', value: 'finance' },
        { name: 'Admin', value: 'admin' }
      )
    )
    .addBooleanOption(o => o.setName('quiet').setDescription('Make the response only visible to you').setRequired(false)),

  async execute(interaction) {
    const quiet = interaction.options.getBoolean('quiet') ?? false;
    const category = interaction.options.getString('category');
    
    if (category) {
      return await showCategoryHelp(interaction, category, quiet);
    }

    const embed = new EmbedBuilder()
      .setColor(colors.primary)
      .setTitle('Command Center')
      .setDescription('Choose a category below, or pass `category` directly when running `/help`.')
      .addFields(
        { name: 'Utility', value: 'General tools and helpers', inline: true },
        { name: 'Integrations', value: 'GitHub, npm, Steam, anime, Spotify, and YouTube', inline: true },
        { name: 'Games', value: 'Store giveaways and game information', inline: true },
        { name: 'Fun', value: 'Interactive games and random commands', inline: true },
        { name: 'Roblox', value: 'Roblox account and game utilities', inline: true },
        { name: 'Social', value: 'Media and Last.fm commands', inline: true },
        { name: 'Finance', value: 'Crypto and currency conversion', inline: true },
        { name: 'Admin', value: 'Timers and scheduled work', inline: true }
      )
      .setFooter({ text: 'Discord Multi-Bot • commands are available in servers and DMs' })
      .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('help_select')
        .setPlaceholder('Select a category...')
        .addOptions([
          { label: 'Utility', value: 'utility' },
          { label: 'Integrations', value: 'integrations' },
          { label: 'Games', value: 'games' },
          { label: 'Fun', value: 'fun' },
          { label: 'Roblox', value: 'roblox' },
          { label: 'Social', value: 'social' },
          { label: 'Finance', value: 'finance' },
          { label: 'Admin', value: 'admin' }
        ])
    );

    await interaction.reply({ embeds: [embed], components: [row], flags: quiet ? 64 : undefined });
    const response = await interaction.fetchReply();

    const collector = response.createMessageComponentCollector({ time: 60000 });
    collector.on('collect', async i => {
      if (i.user.id !== interaction.user.id) return i.reply({ content: 'Use your own /help command!', ephemeral: true });
      await showCategoryHelp(i, i.values[0], quiet, true);
    });
    collector.on('end', async () => {
      const disabled = new ActionRowBuilder().addComponents(
        StringSelectMenuBuilder.from(row.components[0]).setDisabled(true)
      );
      await interaction.editReply({ components: [disabled] }).catch(() => {});
    });
  },
};

async function showCategoryHelp(interaction, category, quiet, isUpdate = false) {
  const commandsPath = path.join(__dirname, '..', category);
  if (!fs.existsSync(commandsPath)) {
    const errorMsg = '❌ This category does not exist or has no commands.';
    return isUpdate ? interaction.update({ content: errorMsg, embeds: [], components: [] }) : interaction.reply({ content: errorMsg, flags: quiet ? 64 : undefined });
  }

  const commandFiles = fs.readdirSync(commandsPath).filter(f => f.endsWith('.js'));
  if (!commandFiles.length) {
    const errorMsg = '❌ This category has no available commands.';
    return isUpdate ? interaction.update({ content: errorMsg, embeds: [], components: [] }) : interaction.reply({ content: errorMsg, flags: quiet ? 64 : undefined });
  }
  const commands = commandFiles.map(file => {
    const cmd = require(path.join(commandsPath, file));
    return `\`/${cmd.data.name}\` - ${cmd.data.description}`;
  });

  const embed = new EmbedBuilder()
    .setColor(colors.primary)
    .setTitle(`${category.charAt(0).toUpperCase() + category.slice(1)} Commands`)
    .setDescription(commands.join('\n'))
    .setFooter({ text: `${commands.length} command${commands.length === 1 ? '' : 's'} in this category` })
    .setTimestamp();

  if (isUpdate) {
    await interaction.update({ embeds: [embed], components: [] });
  } else {
    await interaction.reply({ embeds: [embed], flags: quiet ? 64 : undefined });
  }
}
