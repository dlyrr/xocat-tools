const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');
const { colors } = require('../../../utils/constants');
const { listEffects } = require('../../../services/imageEffects');
const { PREFIX } = require('../../../services/prefixCommandService');

const COMMANDS_ROOT = path.join(__dirname, '..');

// Blurbs for the category picker. Any directory without an entry still shows up,
// it just gets a generic description.
const CATEGORY_INFO = {
  utility: 'General tools and helpers',
  images: 'Image and GIF editing',
  integrations: 'GitHub, npm, Steam, anime, Spotify, and YouTube',
  games: 'Store giveaways and game information',
  fun: 'Interactive games and random commands',
  roblox: 'Roblox account and game utilities',
  social: 'Music and social media lookups',
  finance: 'Crypto and currency conversion',
  admin: 'Timers and scheduled work',
};

const EFFECT_CATEGORY_LABELS = {
  colour: 'Colour & filters',
  geometry: 'Geometry',
  distortion: 'Distortion',
  text: 'Text',
  animation: 'Animation',
};

function titleCase(value) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/** Categories are just the subdirectories of the commands folder. */
function listCategories() {
  return fs.readdirSync(COMMANDS_ROOT, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .sort();
}

/**
 * Load the commands in a category. Helper modules (the `_*.cjs` files) have no
 * `data`, so they are skipped rather than crashing the listing.
 */
function loadCategory(category) {
  const categoryPath = path.join(COMMANDS_ROOT, category);
  if (!fs.existsSync(categoryPath)) return null;

  const commands = [];
  for (const file of fs.readdirSync(categoryPath)) {
    if (!file.endsWith('.js')) continue;
    try {
      const exported = require(path.join(categoryPath, file));
      for (const command of Array.isArray(exported) ? exported : [exported]) {
        if (!command?.data?.name) continue;
        commands.push({
          name: command.data.name,
          description: command.data.description || '',
          // Prepend aliases are objects; show just the typed name.
          aliases: (command.prefixAliases || []).map(alias => (typeof alias === 'string' ? alias : alias.alias)),
        });
      }
    } catch (error) {
      console.error(`[HELP] Could not load ${category}/${file}:`, error.message);
    }
  }
  return commands.sort((a, b) => a.name.localeCompare(b.name));
}

const CATEGORIES = listCategories();

module.exports = {
  data: new SlashCommandBuilder()
    .setName('help')
    .setDescription('List all commands or get help for a category')
    .addStringOption(o => o
      .setName('category')
      .setDescription('The category to view')
      .setRequired(false)
      .addChoices(
        ...CATEGORIES.map(category => ({ name: titleCase(category), value: category })),
        { name: 'Image effects', value: 'effects' },
      ))
    .addBooleanOption(o => o.setName('quiet').setDescription('Make the response only visible to you').setRequired(false)),

  async execute(interaction) {
    const quiet = interaction.options.getBoolean('quiet') ?? false;
    const category = interaction.options.getString('category');

    if (category) {
      return showCategoryHelp(interaction, category, quiet);
    }

    const embed = new EmbedBuilder()
      .setColor(colors.primary)
      .setTitle('Command Center')
      .setDescription(
        'Choose a category below, or pass `category` directly when running `/help`.\n'
        + `Every command also works with the \`${PREFIX}\` prefix — including all ${listEffects().length} image effects, `
        + `for example \`${PREFIX}deepfry\`, \`${PREFIX}magik\`, or \`${PREFIX}meme top text, bottom text\`.`
      )
      .addFields(
        ...CATEGORIES.map(name => ({
          name: titleCase(name),
          value: CATEGORY_INFO[name] || 'Commands in this category',
          inline: true,
        })),
        { name: 'Image effects', value: `All ${listEffects().length} effects available to /image`, inline: true },
      )
      .setFooter({ text: 'Discord Multi-Bot • commands are available in servers and DMs' })
      .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('help_select')
        .setPlaceholder('Select a category...')
        .addOptions([
          ...CATEGORIES.map(name => ({ label: titleCase(name), value: name })),
          { label: 'Image effects', value: 'effects' },
        ])
    );

    await interaction.reply({ embeds: [embed], components: [row], flags: quiet ? 64 : undefined });
    const response = await interaction.fetchReply();

    const collector = response.createMessageComponentCollector({ time: 60000 });
    collector.on('collect', async i => {
      if (i.user.id !== interaction.user.id) return i.reply({ content: 'Use your own /help command!', flags: 64 });
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

function buildEffectsEmbed() {
  const grouped = new Map();
  for (const effect of listEffects()) {
    if (!grouped.has(effect.category)) grouped.set(effect.category, []);
    grouped.get(effect.category).push(effect.name);
  }

  const embed = new EmbedBuilder()
    .setColor(colors.primary)
    .setTitle('Image effects')
    .setDescription(
      `Run any of these with \`/image effect:<name>\` or as a prefix command (\`${PREFIX}deepfry\`).\n`
      + 'The image can be an attachment, a reply, a link, a custom emoji, a mentioned user\'s avatar, '
      + 'or just the last image posted in the channel.'
    )
    .setTimestamp();

  for (const [category, names] of grouped) {
    embed.addFields({
      name: `${EFFECT_CATEGORY_LABELS[category] || category} (${names.length})`,
      value: names.map(name => `\`${name}\``).join(' '),
    });
  }

  return embed.setFooter({ text: `${listEffects().length} effects` });
}

async function showCategoryHelp(interaction, category, quiet, isUpdate = false) {
  if (category === 'effects') {
    const embed = buildEffectsEmbed();
    return isUpdate
      ? interaction.update({ embeds: [embed], components: [] })
      : interaction.reply({ embeds: [embed], flags: quiet ? 64 : undefined });
  }

  const commands = loadCategory(category);
  if (!commands) {
    const message = '❌ This category does not exist or has no commands.';
    return isUpdate
      ? interaction.update({ content: message, embeds: [], components: [] })
      : interaction.reply({ content: message, flags: quiet ? 64 : undefined });
  }
  if (!commands.length) {
    const message = '❌ This category has no available commands.';
    return isUpdate
      ? interaction.update({ content: message, embeds: [], components: [] })
      : interaction.reply({ content: message, flags: quiet ? 64 : undefined });
  }

  const lines = commands.map(command => {
    const aliases = command.aliases.length ? ` _(${command.aliases.map(alias => `${PREFIX}${alias}`).join(', ')})_` : '';
    return `\`/${command.name}\` - ${command.description}${aliases}`;
  });

  const embed = new EmbedBuilder()
    .setColor(colors.primary)
    .setTitle(`${titleCase(category)} Commands`)
    .setDescription(lines.join('\n').slice(0, 4096))
    .setFooter({ text: `${commands.length} command${commands.length === 1 ? '' : 's'} in this category` })
    .setTimestamp();

  if (isUpdate) {
    await interaction.update({ embeds: [embed], components: [] });
  } else {
    await interaction.reply({ embeds: [embed], flags: quiet ? 64 : undefined });
  }
}
