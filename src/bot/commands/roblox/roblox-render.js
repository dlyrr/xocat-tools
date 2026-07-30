// /robloxrender — Render Roblox assets/avatars
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { colors } = require('../../../utils/constants');
const roblox = require('../../../services/robloxService');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('robloxrender')
    .setDescription('Render Roblox asset and avatar thumbnails')
    .addSubcommand(s => s.setName('asset').setDescription('Render a Roblox asset thumbnail').addStringOption(o => o.setName('assetid').setDescription('Asset ID').setRequired(true)).addBooleanOption(
    o => o.setName("quiet").setDescription("Make the response only visible to you").setRequired(false)
  ))
    .addSubcommand(s => s.setName('avatar').setDescription("Render a Roblox user's avatar").addStringOption(o => o.setName('username').setDescription('Roblox username').setRequired(true)).addBooleanOption(
    o => o.setName("quiet").setDescription("Make the response only visible to you").setRequired(false)
  )),
  async execute(interaction) {
    const quiet = interaction.options.getBoolean("quiet") ?? false;
    await interaction.deferReply({
      flags: quiet ? 64 : undefined
    });
    const sub = interaction.options.getSubcommand();
    try {
      if (sub === 'asset') {
        const assetId = interaction.options.getString('assetid');
        const thumbnail = await roblox.getAssetThumbnail(assetId, '420x420');
        if (!thumbnail) return interaction.editReply({ content: '❌ Roblox did not return an asset thumbnail.' });
        const embed = new EmbedBuilder().setColor(colors.roblox).setTitle(`Asset ${assetId}`)
          .setImage(thumbnail)
          .setDescription(`[View on Roblox](https://www.roblox.com/catalog/${assetId})`)
          .setFooter({ text: 'Roblox thumbnail service • 420 × 420' })
          .setTimestamp();
        await interaction.editReply({ embeds: [embed] });
      } else {
        const username = interaction.options.getString('username');
        const user = await roblox.getUserByUsername(username);
        if (!user) return interaction.editReply({ content: '❌ User not found.' });
        const fullBody = await roblox.getUserFullBody(user.id, '420x420');
        if (!fullBody) return interaction.editReply({ content: '❌ Roblox did not return an avatar render.' });
        const embed = new EmbedBuilder().setColor(colors.roblox).setTitle(`${user.name}'s avatar`)
          .setImage(fullBody)
          .setDescription(`[View Profile](https://www.roblox.com/users/${user.id}/profile)`)
          .setFooter({ text: 'Roblox avatar service • 420 × 420' })
          .setTimestamp();
        await interaction.editReply({ embeds: [embed] });
      }
    } catch (err) {
      await interaction.editReply({ content: `❌ Error: ${err.message}` });
    }
  },
};

