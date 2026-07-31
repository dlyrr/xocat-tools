const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { colors } = require('../../../utils/constants');
const { http, addQuiet, truncate, number, date, apiError, quiet } = require('./_shared.cjs');

const data = new SlashCommandBuilder()
  .setName('npm')
  .setDescription('Search npm packages and inspect package details')
  .addSubcommand(subcommand => addQuiet(subcommand
    .setName('package')
    .setDescription('Show versions, downloads, dependencies, and links for a package')
    .addStringOption(option => option.setName('name').setDescription('Exact package name').setRequired(true).setMaxLength(214))))
  .addSubcommand(subcommand => addQuiet(subcommand
    .setName('search')
    .setDescription('Search the public npm registry')
    .addStringOption(option => option.setName('query').setDescription('Package keywords').setRequired(true).setMaxLength(100))));

function repositoryUrl(repository) {
  let value = typeof repository === 'string' ? repository : repository?.url;
  if (!value) return null;
  value = value.replace(/^git\+/, '').replace(/^git:\/\//, 'https://').replace(/\.git$/, '');
  return value.startsWith('http') ? value : null;
}

async function packageDetails(interaction) {
  const name = interaction.options.getString('name', true).trim();
  const encoded = encodeURIComponent(name);
  const [{ data: metadata }, downloads] = await Promise.all([
    http.get(`https://registry.npmjs.org/${encoded}`),
    http.get(`https://api.npmjs.org/downloads/point/last-month/${encoded}`).catch(() => ({ data: null })),
  ]);
  const latestTag = metadata['dist-tags']?.latest;
  const current = metadata.versions?.[latestTag] || {};
  const dependencies = Object.entries(current.dependencies || {});
  const maintainers = (metadata.maintainers || current.maintainers || []).map(item => item.name).filter(Boolean);
  const links = [
    `[npm](https://www.npmjs.com/package/${encodeURIComponent(metadata.name)})`,
    repositoryUrl(current.repository || metadata.repository) ? `[repository](${repositoryUrl(current.repository || metadata.repository)})` : null,
    current.homepage || metadata.homepage ? `[homepage](${current.homepage || metadata.homepage})` : null,
  ].filter(Boolean).join(' • ');

  return new EmbedBuilder()
    .setColor(colors.utility)
    .setTitle(`${metadata.name}@${latestTag || 'unknown'}`)
    .setURL(`https://www.npmjs.com/package/${encodeURIComponent(metadata.name)}`)
    .setDescription(truncate(current.description || metadata.description || 'No package description.', 2000))
    .addFields(
      { name: 'Monthly downloads', value: number(downloads.data?.downloads), inline: true },
      { name: 'Versions', value: number(Object.keys(metadata.versions || {}).length), inline: true },
      { name: 'Latest published', value: date(metadata.time?.[latestTag]), inline: true },
      { name: `Dependencies (${dependencies.length})`, value: truncate(dependencies.length ? dependencies.slice(0, 15).map(([dep, version]) => `\`${dep}\` ${version}`).join('\n') : 'None') },
      { name: 'Maintainers', value: truncate(maintainers.length ? maintainers.join(', ') : 'Not listed'), inline: true },
      { name: 'License', value: truncate(current.license || metadata.license || 'Not listed'), inline: true },
      { name: 'Links', value: links || 'Not listed' },
    )
    .setFooter({ text: 'npm public registry • downloads are for the last month' })
    .setTimestamp();
}

async function search(interaction) {
  const query = interaction.options.getString('query', true).trim();
  const { data: result } = await http.get('https://registry.npmjs.org/-/v1/search', { params: { text: query, size: 8 } });
  const objects = result.objects || [];
  if (!objects.length) throw Object.assign(new Error('No npm packages matched that search.'), { friendly: true });
  const lines = objects.map(({ package: pkg, score }) => {
    const quality = Math.round((score?.final || 0) * 100);
    return `**[${pkg.name}](https://www.npmjs.com/package/${encodeURIComponent(pkg.name)})** · \`${pkg.version}\` · ${quality}% match\n${truncate(pkg.description || 'No description.', 160)}`;
  });
  return new EmbedBuilder()
    .setColor(colors.utility)
    .setTitle(`npm search: ${truncate(query, 200)}`)
    .setDescription(truncate(lines.join('\n\n'), 4000))
    .setFooter({ text: `${objects.length} result${objects.length === 1 ? '' : 's'} from the npm public registry` })
    .setTimestamp();
}

module.exports = {
  prefixGreedy: 'query',
  prefixAliases: ['node', 'package'],
  data,
  async execute(interaction) {
    await interaction.deferReply({ flags: quiet(interaction) ? 64 : undefined });
    try {
      const embed = interaction.options.getSubcommand() === 'package'
        ? await packageDetails(interaction)
        : await search(interaction);
      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      await interaction.editReply({ content: error.friendly ? error.message : apiError(error, 'Could not retrieve npm data.') });
    }
  },
};
