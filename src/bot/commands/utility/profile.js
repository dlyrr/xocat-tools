// /profile — User profile
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { colors, emojis } = require('../../../utils/constants');
const { getOrCreateProfile } = require('../../../database/db');
const { isPremium } = require('../../../utils/premium');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('profile')
    .setDescription('Display user info and rank')
    .addUserOption(o => o.setName('user').setDescription('User to check').setRequired(false)).addBooleanOption(
    o => o.setName("quiet").setDescription("Make the response only visible to you").setRequired(false)
  ),
  async execute(interaction) {
    const quiet = interaction.options.getBoolean("quiet") ?? false;
    const user = interaction.options.getUser('user') || interaction.user;
    const profile = getOrCreateProfile(user.id);
    const premium = isPremium(user.id);
    const previousLevelXp = (profile.level - 1) * 100;
    const nextLevelXp = profile.level * 100;
    const currentXp = Math.max(0, profile.xp - previousLevelXp);
    const levelSpan = nextLevelXp - previousLevelXp;
    const progressBar = createProgressBar(currentXp, levelSpan, 20);

    const embed = new EmbedBuilder()
      .setColor(premium ? colors.premium : colors.primary)
      .setTitle(`${user.displayName}'s profile`)
      .setThumbnail(user.displayAvatarURL({ size: 256 }))
      .addFields(
        { name: 'Level', value: `**${profile.level}**`, inline: true },
        { name: 'Total XP', value: `**${profile.xp}**`, inline: true },
        { name: 'Commands used', value: `**${profile.commands_used}**`, inline: true },
        { name: 'Next level', value: `${progressBar}\n${currentXp} / ${levelSpan} XP`, inline: false },
        { name: 'Status', value: premium ? '**Premium**' : 'Free', inline: true },
      )
      .setFooter({ text: `ID: ${user.id}` })
      .setTimestamp();
    await interaction.reply({
      embeds: [embed],
      flags: quiet ? 64 : undefined
    });
  },
};

function createProgressBar(current, max, length) {
  const filled = Math.round((current / max) * length);
  const empty = length - filled;
  return `\`[${'█'.repeat(filled)}${'░'.repeat(empty)}]\` ${Math.round((current / max) * 100)}%`;
}

