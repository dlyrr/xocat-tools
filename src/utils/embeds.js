// ============================================================
// Embed Builder Helpers
// ============================================================
const { EmbedBuilder } = require('discord.js');
const { colors, emojis } = require('./constants');

/**
 * Create a standard success embed
 */
function successEmbed(title, description) {
  return new EmbedBuilder()
    .setColor(colors.primary)
    .setTitle(title)
    .setDescription(description)
    .setFooter({ text: 'Discord Multi-Bot • completed' })
    .setTimestamp();
}

/**
 * Create a standard error embed
 */
function errorEmbed(title, description) {
  return new EmbedBuilder()
    .setColor(colors.error)
    .setTitle(title)
    .setDescription(description || 'An unexpected error occurred.')
    .setFooter({ text: 'Discord Multi-Bot • check the details above' })
    .setTimestamp();
}

/**
 * Create a standard info embed
 */
function infoEmbed(title, description) {
  return new EmbedBuilder()
    .setColor(colors.info)
    .setTitle(title)
    .setDescription(description)
    .setFooter({ text: 'Discord Multi-Bot • information' })
    .setTimestamp();
}

/**
 * Create a loading embed
 */
function loadingEmbed(description = 'Processing your request...') {
  return new EmbedBuilder()
    .setColor(colors.primary)
    .setTitle('Please wait')
    .setDescription(description)
    .setFooter({ text: 'Discord Multi-Bot • working' });
}

/**
 * Create a premium-required embed
 */
function premiumEmbed() {
  return new EmbedBuilder()
    .setColor(colors.premium)
    .setTitle('Premium required')
    .setDescription(
      'This command requires **Premium** access.\n\n' +
      'Contact the bot owner for premium access.'
    )
    .setTimestamp();
}

/**
 * Create a themed embed for a specific category
 */
function categoryEmbed(category, title, description) {
  const categoryColors = {
    roblox: colors.roblox,
    ai: colors.ai,
    premium: colors.premium,
    fun: colors.fun,
    social: colors.social,
    finance: colors.finance,
    crypto: colors.crypto,
    admin: colors.admin,
    utility: colors.utility,
    spotify: colors.spotify,
    games: colors.fun,
  };

  return new EmbedBuilder()
    .setColor(categoryColors[category] || colors.primary)
    .setTitle(title)
    .setDescription(description)
    .setFooter({ text: `Discord Multi-Bot • ${category}` })
    .setTimestamp();
}

module.exports = {
  successEmbed,
  errorEmbed,
  infoEmbed,
  loadingEmbed,
  premiumEmbed,
  categoryEmbed,
};
