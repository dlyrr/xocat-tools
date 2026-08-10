const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  SlashCommandBuilder,
} = require('discord.js');
const { colors } = require('../../../utils/constants');
const { findUnicodeEmoji } = require('../../../services/mediaResolver');

const CUSTOM_EMOJI_GLOBAL = /<(a?):([A-Za-z0-9_]{2,32}):(\d{15,22})>/g;
const MAX_EMOJI = 10;

function parseCustomEmoji(value) {
  const match = String(value || '').trim().match(/^<(a?):([A-Za-z0-9_]{2,32}):(\d{15,22})>$/);
  if (!match) return null;
  return { animated: match[1] === 'a', name: match[2], id: match[3] };
}

/**
 * Pull every emoji out of the input. esmBot's `emote` accepts a whole line of
 * them, and unicode emoji resolve through the Apple image set.
 */
function parseEmojiList(value) {
  const input = String(value || '');
  const found = [];

  for (const match of input.matchAll(CUSTOM_EMOJI_GLOBAL)) {
    const animated = match[1] === 'a';
    found.push({
      kind: 'custom',
      animated,
      name: match[2],
      id: match[3],
      extension: animated ? 'gif' : 'png',
      url: `https://cdn.discordapp.com/emojis/${match[3]}.${animated ? 'gif' : 'png'}?size=4096&quality=lossless`,
    });
    if (found.length >= MAX_EMOJI) return found;
  }

  if (found.length) return found;

  // Fall back to unicode: strip any custom-emoji syntax first so a stray
  // variation selector inside one cannot be picked up.
  const stripped = input.replace(CUSTOM_EMOJI_GLOBAL, ' ');
  const unicode = findUnicodeEmoji(stripped);
  if (unicode) {
    found.push({
      kind: 'unicode',
      animated: false,
      name: stripped.trim().slice(0, 32) || 'emoji',
      id: null,
      extension: 'png',
      url: unicode.url,
    });
  }

  return found;
}

function addEmojiOption(subcommand) {
  return subcommand
    .addStringOption(option => option
      .setName('emoji')
      .setDescription('Paste one or more custom Discord emoji, or a single unicode emoji')
      .setRequired(true)
      .setMaxLength(500))
    .addBooleanOption(option => option.setName('quiet').setDescription('Only show the response to you'));
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('emoji')
    .setDescription('View, enlarge, download, or inspect emoji')
    .addSubcommand(subcommand => addEmojiOption(subcommand.setName('view').setDescription('View emoji at full size')))
    .addSubcommand(subcommand => addEmojiOption(subcommand.setName('info').setDescription('Show information about emoji')))
    .addSubcommand(subcommand => addEmojiOption(subcommand.setName('download').setDescription('Get direct download links for emoji'))),

  prefixAliases: ['emote', 'jumbo', 'enlarge'],
  prefixGreedy: 'emoji',

  async execute(interaction) {
    const emoji = parseEmojiList(interaction.options.getString('emoji', true));
    const quiet = interaction.options.getBoolean('quiet') ? 64 : undefined;

    if (!emoji.length) {
      return interaction.reply({
        content: 'Paste a custom Discord emoji such as `<:name:123456789012345678>`, or a unicode emoji like 🎲.',
        flags: 64,
      });
    }

    const subcommand = interaction.options.getSubcommand();

    // Several emoji at once cannot each get their own image embed, so list the
    // links and preview the first one.
    if (emoji.length > 1) {
      const embed = new EmbedBuilder()
        .setColor(colors.utility)
        .setTitle(`${emoji.length} emoji`)
        .setDescription(emoji.map(entry => `[${entry.name}](${entry.url})${entry.animated ? ' · animated' : ''}`).join('\n'))
        .setImage(emoji[0].url)
        .setFooter({ text: `Showing ${emoji[0].name} · links for the rest above` });

      if (subcommand === 'info') {
        embed.addFields(emoji.slice(0, 25).map(entry => ({
          name: entry.name,
          value: entry.id ? `\`${entry.id}\` · ${entry.extension.toUpperCase()}` : `unicode · ${entry.extension.toUpperCase()}`,
          inline: true,
        })));
      }

      return interaction.reply({ embeds: [embed], flags: quiet });
    }

    const [single] = emoji;
    const embed = new EmbedBuilder()
      .setColor(colors.utility)
      .setTitle(single.name)
      .setImage(single.url)
      .setFooter({
        text: single.kind === 'unicode'
          ? 'Unicode emoji (Apple artwork)'
          : single.animated ? 'Animated custom emoji' : 'Static custom emoji',
      });

    if (subcommand === 'info') {
      const guildEmoji = single.id ? interaction.guild?.emojis.cache.get(single.id) : null;
      embed.addFields(
        { name: 'Emoji ID', value: single.id ? `\`${single.id}\`` : 'n/a (unicode)', inline: true },
        { name: 'Format', value: single.extension.toUpperCase(), inline: true },
        { name: 'Available here', value: single.id ? (guildEmoji ? 'Yes' : 'No or external') : 'Everywhere', inline: true },
        ...(guildEmoji?.createdTimestamp ? [{ name: 'Created', value: `<t:${Math.floor(guildEmoji.createdTimestamp / 1000)}:F>`, inline: true }] : [])
      );
    }

    if (subcommand === 'download') embed.setDescription('Use the button below to open or save the original emoji file.');

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setStyle(ButtonStyle.Link)
        .setLabel(subcommand === 'download' ? 'Open original file' : 'Open emoji')
        .setURL(single.url)
    );

    return interaction.reply({ embeds: [embed], components: [row], flags: quiet });
  },

  parseCustomEmoji,
  parseEmojiList,
};
