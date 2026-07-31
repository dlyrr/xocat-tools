// ============================================================
// /uncaption — strip a caption bar off an image or GIF
// ------------------------------------------------------------
// Runs on the shared effect engine so it picks up flexible image sourcing
// (reply, link, emoji, avatar, channel history) and esmBot's tolerance option,
// while keeping this bot's stronger detection: solid light *or* dark bars, on
// the top and/or the bottom, confirmed over a run of near-uniform rows.
// ============================================================
const { SlashCommandBuilder } = require('discord.js');
const { runEffect } = require('../../../services/mediaCommand');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('uncaption')
    .setDescription('Remove a caption bar from an image or GIF')
    .addAttachmentOption(o => o
      .setName('file')
      .setDescription('The captioned image or GIF (defaults to the most recent one in the channel)')
      .setRequired(false))
    .addStringOption(o => o
      .setName('link')
      .setDescription('An image URL, custom emoji, or user ID to use instead of an attachment')
      .setRequired(false)
      .setMaxLength(500))
    .addUserOption(o => o
      .setName('user')
      .setDescription("Uncaption this user's avatar")
      .setRequired(false))
    .addNumberOption(o => o
      .setName('amount')
      .setDescription('How far off pure white/black a bar may be (0-1, default 0.5) — raise it for off-white bars')
      .setRequired(false)
      .setMinValue(0)
      .setMaxValue(1))
    .addBooleanOption(o => o.setName('quiet').setDescription('Make the response only visible to you').setRequired(false)),

  prefixAliases: ['uncap'],

  async execute(interaction) {
    return runEffect(interaction, 'uncaption', { title: 'Uncaption' });
  },
};
