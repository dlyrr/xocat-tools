// ============================================================
// /sticker — get the raw image behind a Discord sticker
// ------------------------------------------------------------
// Stickers cannot be passed as a slash option, so this looks at the message
// being replied to (prefix), an explicit message ID, and then recent channel
// history — the same escalation esmBot uses for its sticker detection.
// ============================================================
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, SlashCommandBuilder } = require('discord.js');
const { colors } = require('../../../utils/constants');

// Discord sticker format types.
const FORMATS = {
  1: { label: 'PNG', extension: 'png', renderable: true },
  2: { label: 'APNG (animated PNG)', extension: 'png', renderable: true },
  3: { label: 'Lottie (vector JSON)', extension: 'json', renderable: false },
  4: { label: 'GIF', extension: 'gif', renderable: true },
};

function stickerUrl(sticker, format) {
  if (format.extension === 'gif') return `https://media.discordapp.net/stickers/${sticker.id}.gif`;
  return `https://cdn.discordapp.com/stickers/${sticker.id}.${format.extension}`;
}

function parseMessageId(input) {
  const value = String(input ?? '').trim();
  const link = value.match(/\/channels\/\d+\/(\d+)\/(\d+)/);
  if (link) return link[2];
  return /^\d{15,25}$/.test(value) ? value : null;
}

async function findSticker(interaction) {
  const explicit = (() => {
    try {
      return interaction.options.getString('message');
    } catch {
      return null;
    }
  })();

  if (explicit) {
    const id = parseMessageId(explicit);
    if (!id) throw new Error('That is not a message ID or message link.');
    const message = await interaction.channel?.messages?.fetch(id).catch(() => null);
    if (!message) throw new Error('I could not find that message in this channel.');
    const sticker = message.stickers?.first();
    if (!sticker) throw new Error('That message does not have a sticker on it.');
    return { sticker, source: 'the message you pointed at' };
  }

  const invoking = interaction.message;
  if (invoking?.stickers?.size) return { sticker: invoking.stickers.first(), source: 'your message' };

  const reference = invoking?.reference || invoking?.messageReference;
  const referencedId = reference?.messageId || reference?.messageID;
  if (referencedId) {
    const replied = await invoking.channel?.messages?.fetch(referencedId).catch(() => null);
    if (replied?.stickers?.size) return { sticker: replied.stickers.first(), source: 'the message you replied to' };
  }

  const messages = await interaction.channel?.messages?.fetch({ limit: 50 }).catch(() => null);
  for (const message of messages?.values() || []) {
    if (message.stickers?.size) return { sticker: message.stickers.first(), source: 'recent channel history' };
  }

  return null;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('sticker')
    .setDescription('Get the raw image file behind a Discord sticker')
    .addStringOption(o => o
      .setName('message')
      .setDescription('A message ID or link containing the sticker (defaults to the most recent one in the channel)')
      .setRequired(false)
      .setMaxLength(200))
    .addBooleanOption(o => o.setName('quiet').setDescription('Make the response only visible to you').setRequired(false)),

  prefixAliases: ['stick'],

  async execute(interaction) {
    const quiet = interaction.options.getBoolean('quiet') ?? false;
    await interaction.deferReply({ flags: quiet ? 64 : undefined });

    let found;
    try {
      found = await findSticker(interaction);
    } catch (error) {
      return interaction.editReply(`❌ ${error.message}`);
    }

    if (!found) {
      return interaction.editReply('❌ I could not find a sticker. Reply to a message with one, or pass its message ID.');
    }

    const { sticker, source } = found;
    const format = FORMATS[sticker.format] || { label: `Unknown (${sticker.format})`, extension: 'png', renderable: false };
    const url = stickerUrl(sticker, format);

    const embed = new EmbedBuilder()
      .setColor(colors.utility)
      .setTitle(sticker.name || 'Sticker')
      .addFields(
        { name: 'Format', value: format.label, inline: true },
        { name: 'ID', value: sticker.id, inline: true },
        { name: 'Found via', value: source, inline: true },
      )
      .setTimestamp();

    if (sticker.description) embed.setDescription(sticker.description.slice(0, 2000));
    if (format.renderable) {
      embed.setImage(url);
    } else {
      embed.addFields({ name: 'Note', value: 'Lottie stickers are vector animations, so Discord cannot render them as an image. The link below is the raw JSON.' });
    }

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setLabel(`Open ${format.extension.toUpperCase()}`).setStyle(ButtonStyle.Link).setURL(url)
    );

    return interaction.editReply({ embeds: [embed], components: [row] });
  },
};
