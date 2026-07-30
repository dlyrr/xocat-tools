const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  SlashCommandBuilder,
} = require('discord.js');
const { colors } = require('../../../utils/constants');

function parseCustomEmoji(value) {
  const match = String(value || '').trim().match(/^<(a?):([A-Za-z0-9_]{2,32}):(\d{15,22})>$/);
  if (!match) return null;
  return { animated: match[1] === 'a', name: match[2], id: match[3] };
}

function addEmojiOption(subcommand) {
  return subcommand
    .addStringOption(option => option.setName('emoji').setDescription('Paste a custom Discord emoji').setRequired(true).setMaxLength(100))
    .addBooleanOption(option => option.setName('quiet').setDescription('Only show the response to you'));
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('emoji')
    .setDescription('View, enlarge, download, or inspect a custom emoji')
    .addSubcommand(subcommand => addEmojiOption(subcommand.setName('view').setDescription('View a custom emoji at full size')))
    .addSubcommand(subcommand => addEmojiOption(subcommand.setName('info').setDescription('Show information about a custom emoji')))
    .addSubcommand(subcommand => addEmojiOption(subcommand.setName('download').setDescription('Get a direct download link for a custom emoji'))),

  async execute(interaction) {
    const parsed = parseCustomEmoji(interaction.options.getString('emoji', true));
    if (!parsed) return interaction.reply({ content: 'Paste a custom Discord emoji such as `<:name:123456789012345678>`.', flags: 64 });
    const extension = parsed.animated ? 'gif' : 'png';
    const url = `https://cdn.discordapp.com/emojis/${parsed.id}.${extension}?size=4096&quality=lossless`;
    const subcommand = interaction.options.getSubcommand();
    const embed = new EmbedBuilder()
      .setColor(colors.utility)
      .setTitle(parsed.name)
      .setImage(url)
      .setFooter({ text: parsed.animated ? 'Animated custom emoji' : 'Static custom emoji' });
    if (subcommand === 'info') {
      const guildEmoji = interaction.guild?.emojis.cache.get(parsed.id);
      embed.addFields(
        { name: 'Emoji ID', value: `\`${parsed.id}\``, inline: true },
        { name: 'Format', value: extension.toUpperCase(), inline: true },
        { name: 'Available here', value: guildEmoji ? 'Yes' : 'No or external', inline: true },
        ...(guildEmoji?.createdTimestamp ? [{ name: 'Created', value: `<t:${Math.floor(guildEmoji.createdTimestamp / 1000)}:F>`, inline: true }] : [])
      );
    }
    if (subcommand === 'download') embed.setDescription('Use the button below to open or save the original emoji file.');
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel(subcommand === 'download' ? 'Open original file' : 'Open emoji').setURL(url)
    );
    return interaction.reply({ embeds: [embed], components: [row], flags: interaction.options.getBoolean('quiet') ? 64 : undefined });
  },

  parseCustomEmoji,
};
