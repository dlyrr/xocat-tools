const sharp = require('sharp');
const { AttachmentBuilder, EmbedBuilder, SlashCommandBuilder } = require('discord.js');

function parseColor(input) {
  const value = input.trim();
  const hexMatch = value.match(/^#?([\da-f]{3}|[\da-f]{6})$/i);
  if (hexMatch) {
    const expanded = hexMatch[1].length === 3 ? [...hexMatch[1]].map(c => c + c).join('') : hexMatch[1];
    const number = parseInt(expanded, 16);
    return { r: number >> 16, g: (number >> 8) & 255, b: number & 255 };
  }
  const rgbMatch = value.match(/^(?:rgb\()?\s*(\d{1,3})\s*[, ]\s*(\d{1,3})\s*[, ]\s*(\d{1,3})\s*\)?$/i);
  if (rgbMatch) {
    const rgb = rgbMatch.slice(1).map(Number);
    if (rgb.every(channel => channel >= 0 && channel <= 255)) return { r: rgb[0], g: rgb[1], b: rgb[2] };
  }
  return null;
}

function conversions({ r, g, b }) {
  const rn = r / 255; const gn = g / 255; const bn = b / 255;
  const max = Math.max(rn, gn, bn); const min = Math.min(rn, gn, bn); const delta = max - min;
  let h = 0;
  if (delta) {
    if (max === rn) h = 60 * (((gn - bn) / delta) % 6);
    else if (max === gn) h = 60 * ((bn - rn) / delta + 2);
    else h = 60 * ((rn - gn) / delta + 4);
  }
  if (h < 0) h += 360;
  const l = (max + min) / 2;
  const sHsl = delta === 0 ? 0 : delta / (1 - Math.abs(2 * l - 1));
  const sHsv = max === 0 ? 0 : delta / max;
  const hex = `#${[r, g, b].map(v => v.toString(16).padStart(2, '0')).join('').toUpperCase()}`;
  return {
    hex,
    rgb: `rgb(${r}, ${g}, ${b})`,
    hsl: `hsl(${Math.round(h)}, ${Math.round(sHsl * 100)}%, ${Math.round(l * 100)}%)`,
    hsv: `hsv(${Math.round(h)}, ${Math.round(sHsv * 100)}%, ${Math.round(max * 100)}%)`,
  };
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('color')
    .setDescription('Preview a color and convert it to HEX, RGB, HSL, and HSV')
    .addStringOption(o => o.setName('value').setDescription('HEX or RGB, such as #7C3AED or 124, 58, 237').setRequired(true).setMaxLength(50))
    .addBooleanOption(o => o.setName('quiet').setDescription('Make the response only visible to you')),

  async execute(interaction) {
    const parsed = parseColor(interaction.options.getString('value', true));
    const quiet = interaction.options.getBoolean('quiet') ?? false;
    if (!parsed) return interaction.reply({ content: 'Use a valid HEX (`#7C3AED`) or RGB (`124, 58, 237`) color.', flags: 64 });
    const converted = conversions(parsed);
    const swatch = await sharp({ create: { width: 640, height: 240, channels: 4, background: parsed } }).png().toBuffer();
    const file = new AttachmentBuilder(swatch, { name: 'color-preview.png' });
    const embed = new EmbedBuilder()
      .setColor(parseInt(converted.hex.slice(1), 16))
      .setTitle(converted.hex)
      .setImage('attachment://color-preview.png')
      .addFields(
        { name: 'HEX', value: `\`${converted.hex}\``, inline: true },
        { name: 'RGB', value: `\`${converted.rgb}\``, inline: true },
        { name: 'HSL', value: `\`${converted.hsl}\``, inline: true },
        { name: 'HSV', value: `\`${converted.hsv}\``, inline: true },
      );
    return interaction.reply({ embeds: [embed], files: [file], flags: quiet ? 64 : undefined });
  },

  parseColor,
  conversions,
};
