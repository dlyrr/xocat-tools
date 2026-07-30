const axios = require('axios');
const { EmbedBuilder, SlashCommandBuilder } = require('discord.js');

const GITHUB_COLOR = 0x24292F;
const GITHUB_ICON = 'https://github.githubassets.com/favicons/favicon.png';
const API_TIMEOUT = 12000;

const githubApi = axios.create({
  baseURL: 'https://api.github.com',
  timeout: API_TIMEOUT,
  headers: {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'xocat-discord-bot',
    'X-GitHub-Api-Version': '2022-11-28',
  },
});

githubApi.interceptors.request.use(config => {
  const token = process.env.GITHUB_TOKEN?.trim();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

function truncate(value, limit = 1024) {
  const text = String(value || '');
  return text.length <= limit ? text : `${text.slice(0, limit - 3)}...`;
}

function compactNumber(value) {
  return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(value || 0);
}

function exactNumber(value) {
  return new Intl.NumberFormat('en-US').format(value || 0);
}

function discordDate(value, style = 'D') {
  const seconds = Math.floor(new Date(value).getTime() / 1000);
  return Number.isFinite(seconds) ? `<t:${seconds}:${style}>` : 'Unknown';
}

function cleanInline(value) {
  return String(value || '').replace(/`/g, '\u02cb').replace(/\r?\n/g, ' ');
}

function parseRepository(value) {
  let input = String(value || '').trim();
  try {
    if (/^https?:\/\//i.test(input)) {
      const url = new URL(input);
      if (!['github.com', 'www.github.com'].includes(url.hostname.toLowerCase())) throw new Error();
      input = url.pathname;
    }
  } catch {
    throw new Error('Use a GitHub repository such as `owner/repository` or its GitHub URL.');
  }

  const parts = input.replace(/^\/+|\/+$/g, '').replace(/\.git$/i, '').split('/');
  if (parts.length !== 2 || parts.some(part => !/^[A-Za-z0-9_.-]+$/.test(part))) {
    throw new Error('Use a GitHub repository such as `owner/repository` or its GitHub URL.');
  }
  return { owner: parts[0], repo: parts[1], fullName: `${parts[0]}/${parts[1]}` };
}

function baseEmbed() {
  return new EmbedBuilder()
    .setColor(GITHUB_COLOR)
    .setAuthor({ name: 'GitHub', iconURL: GITHUB_ICON, url: 'https://github.com' })
    .setTimestamp();
}

function apiError(error) {
  if (error.message?.startsWith('Use a GitHub repository')) return error.message;
  if (error.code === 'ECONNABORTED') return 'GitHub took too long to respond. Try again in a moment.';

  const status = error.response?.status;
  const message = error.response?.data?.message;
  if (status === 404) return 'GitHub could not find that public user or repository.';
  if (status === 403 && error.response?.headers?.['x-ratelimit-remaining'] === '0') {
    const reset = Number(error.response.headers['x-ratelimit-reset']);
    return `GitHub's API rate limit has been reached${reset ? `; it resets <t:${reset}:R>` : ''}. Add a \`GITHUB_TOKEN\` to increase the limit.`;
  }
  if (status === 401) return 'GitHub rejected the configured `GITHUB_TOKEN`. Check or remove it.';
  if (status === 409) return message || 'That repository is empty or unavailable.';
  return truncate(message || error.message || 'GitHub returned an unexpected error.', 400);
}

function addRepositoryOption(subcommand) {
  return subcommand.addStringOption(option => option
    .setName('repository')
    .setDescription('Repository as owner/name or a GitHub URL')
    .setRequired(true)
    .setMaxLength(200));
}

function addLimitOption(subcommand, description) {
  return subcommand.addIntegerOption(option => option
    .setName('limit')
    .setDescription(description)
    .setMinValue(1)
    .setMaxValue(10));
}

function addQuietOption(subcommand) {
  return subcommand.addBooleanOption(option => option
    .setName('quiet')
    .setDescription('Make the response only visible to you'));
}

function buildCommand() {
  return new SlashCommandBuilder()
    .setName('github')
    .setDescription('Look up GitHub users, repositories, releases, commits, issues, and languages')
    .addSubcommand(subcommand => addQuietOption(subcommand
      .setName('user')
      .setDescription('Show a GitHub user profile')
      .addStringOption(option => option
        .setName('username')
        .setDescription('GitHub username')
        .setRequired(true)
        .setMaxLength(39))))
    .addSubcommand(subcommand => addQuietOption(addRepositoryOption(subcommand
      .setName('repo')
      .setDescription('Show repository details and statistics'))))
    .addSubcommand(subcommand => addQuietOption(addLimitOption(addRepositoryOption(subcommand
      .setName('releases')
      .setDescription('Show recent repository releases')), 'Number of releases to show (default 5)')))
    .addSubcommand(subcommand => addQuietOption(addLimitOption(addRepositoryOption(subcommand
      .setName('commits')
      .setDescription('Show recent repository commits')), 'Number of commits to show (default 5)')
      .addStringOption(option => option
        .setName('branch')
        .setDescription('Branch, tag, or commit SHA (defaults to the repository default)')
        .setMaxLength(100))))
    .addSubcommand(subcommand => addQuietOption(addLimitOption(addRepositoryOption(subcommand
      .setName('issues')
      .setDescription('Show repository issues')), 'Number of issues to show (default 5)')
      .addStringOption(option => option
        .setName('state')
        .setDescription('Issue state (default open)')
        .addChoices(
          { name: 'Open', value: 'open' },
          { name: 'Closed', value: 'closed' },
          { name: 'All', value: 'all' }
        ))))
    .addSubcommand(subcommand => addQuietOption(addRepositoryOption(subcommand
      .setName('languages')
      .setDescription('Show repository language usage'))));
}

async function showUser(interaction) {
  const username = interaction.options.getString('username', true).trim().replace(/^@/, '');
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/.test(username)) {
    throw new Error('Enter a valid GitHub username.');
  }
  const { data: user } = await githubApi.get(`/users/${encodeURIComponent(username)}`);
  const details = [user.company, user.location, user.blog].filter(Boolean).map(cleanInline).join(' • ');
  const embed = baseEmbed()
    .setTitle(truncate(user.name ? `${user.name} (@${user.login})` : user.login, 256))
    .setURL(user.html_url)
    .setThumbnail(user.avatar_url)
    .setDescription(truncate(user.bio || 'No public bio.', 2048))
    .addFields(
      { name: 'Followers', value: exactNumber(user.followers), inline: true },
      { name: 'Following', value: exactNumber(user.following), inline: true },
      { name: 'Public repositories', value: exactNumber(user.public_repos), inline: true },
      { name: 'Account created', value: discordDate(user.created_at), inline: true },
      { name: 'Profile type', value: user.type || 'User', inline: true }
    );
  if (details) embed.addFields({ name: 'Details', value: truncate(details) });
  return embed;
}

async function showRepo(interaction, repository) {
  const { data: repo } = await githubApi.get(`/repos/${repository.owner}/${repository.repo}`);
  const topics = repo.topics?.length ? repo.topics.slice(0, 12).map(topic => `\`${topic}\``).join(' ') : null;
  const embed = baseEmbed()
    .setTitle(truncate(repo.full_name, 256))
    .setURL(repo.html_url)
    .setThumbnail(repo.owner?.avatar_url)
    .setDescription(truncate(repo.description || 'No description.', 2048))
    .addFields(
      { name: 'Stars', value: compactNumber(repo.stargazers_count), inline: true },
      { name: 'Forks', value: compactNumber(repo.forks_count), inline: true },
      { name: 'Watchers', value: compactNumber(repo.subscribers_count), inline: true },
      { name: 'Open issues / PRs', value: exactNumber(repo.open_issues_count), inline: true },
      { name: 'Primary language', value: repo.language || 'Not detected', inline: true },
      { name: 'License', value: repo.license?.spdx_id || 'None', inline: true },
      { name: 'Default branch', value: `\`${cleanInline(repo.default_branch)}\``, inline: true },
      { name: 'Created', value: discordDate(repo.created_at), inline: true },
      { name: 'Last pushed', value: discordDate(repo.pushed_at, 'R'), inline: true }
    );
  if (topics) embed.addFields({ name: 'Topics', value: topics });
  if (repo.archived || repo.fork) {
    embed.setFooter({ text: [repo.archived && 'Archived', repo.fork && 'Fork'].filter(Boolean).join(' • ') });
  }
  return embed;
}

async function showReleases(interaction, repository) {
  const limit = interaction.options.getInteger('limit') || 5;
  const { data } = await githubApi.get(`/repos/${repository.owner}/${repository.repo}/releases`, {
    params: { per_page: limit },
  });
  const lines = data.map(release => {
    const label = truncate(cleanInline(release.name || release.tag_name), 100);
    const status = [release.draft && 'draft', release.prerelease && 'pre-release'].filter(Boolean).join(', ');
    return `**[${label}](${release.html_url})**${status ? ` • ${status}` : ''}\n\`${cleanInline(release.tag_name)}\` • ${discordDate(release.published_at || release.created_at, 'R')} • ${exactNumber(release.assets?.length)} assets`;
  });
  return baseEmbed()
    .setTitle(`Releases · ${repository.fullName}`)
    .setURL(`https://github.com/${repository.fullName}/releases`)
    .setDescription(lines.length ? truncate(lines.join('\n\n'), 4000) : 'This repository has no published releases.');
}

async function showCommits(interaction, repository) {
  const limit = interaction.options.getInteger('limit') || 5;
  const branch = interaction.options.getString('branch')?.trim();
  const { data } = await githubApi.get(`/repos/${repository.owner}/${repository.repo}/commits`, {
    params: { per_page: limit, ...(branch ? { sha: branch } : {}) },
  });
  const lines = data.map(commit => {
    const message = truncate(cleanInline(commit.commit?.message?.split('\n')[0] || 'No commit message'), 120);
    const author = cleanInline(commit.author?.login || commit.commit?.author?.name || 'Unknown');
    return `**[\`${commit.sha.slice(0, 7)}\`](${commit.html_url}) ${message}**\nby ${author} • ${discordDate(commit.commit?.author?.date, 'R')}`;
  });
  const suffix = branch ? ` · ${branch}` : '';
  return baseEmbed()
    .setTitle(truncate(`Commits · ${repository.fullName}${suffix}`, 256))
    .setURL(`https://github.com/${repository.fullName}/commits${branch ? `/${encodeURIComponent(branch)}` : ''}`)
    .setDescription(lines.length ? truncate(lines.join('\n\n'), 4000) : 'No commits were returned.');
}

async function showIssues(interaction, repository) {
  const limit = interaction.options.getInteger('limit') || 5;
  const state = interaction.options.getString('state') || 'open';
  const { data } = await githubApi.get(`/repos/${repository.owner}/${repository.repo}/issues`, {
    params: { state, per_page: Math.min(limit * 3, 30), sort: 'updated', direction: 'desc' },
  });
  const issues = data.filter(issue => !issue.pull_request).slice(0, limit);
  const lines = issues.map(issue => {
    const labels = issue.labels?.slice(0, 3).map(label => `\`${cleanInline(label.name)}\``).join(' ');
    return `**[#${issue.number} ${truncate(cleanInline(issue.title), 120)}](${issue.html_url})**\n${issue.state} • ${exactNumber(issue.comments)} comments • updated ${discordDate(issue.updated_at, 'R')}${labels ? `\n${labels}` : ''}`;
  });
  return baseEmbed()
    .setTitle(`${state[0].toUpperCase()}${state.slice(1)} issues · ${repository.fullName}`)
    .setURL(`https://github.com/${repository.fullName}/issues?q=is%3Aissue${state === 'all' ? '' : `+is%3A${state}`}`)
    .setDescription(lines.length ? truncate(lines.join('\n\n'), 4000) : `No ${state === 'all' ? '' : `${state} `}issues were found.`)
    .setFooter({ text: 'Pull requests are excluded' });
}

async function showLanguages(interaction, repository) {
  const { data } = await githubApi.get(`/repos/${repository.owner}/${repository.repo}/languages`);
  const languages = Object.entries(data).sort((a, b) => b[1] - a[1]);
  const total = languages.reduce((sum, [, bytes]) => sum + bytes, 0);
  const rows = languages.slice(0, 12).map(([language, bytes], index) => {
    const percentage = total ? (bytes / total) * 100 : 0;
    const barLength = Math.max(1, Math.round(percentage / 5));
    return `${index + 1}. **${language}** — ${percentage.toFixed(1)}%\n${'━'.repeat(barLength)}${'─'.repeat(20 - barLength)}  ${exactNumber(bytes)} bytes`;
  });
  return baseEmbed()
    .setTitle(`Languages · ${repository.fullName}`)
    .setURL(`https://github.com/${repository.fullName}`)
    .setDescription(rows.length ? truncate(rows.join('\n\n'), 4000) : 'GitHub has not detected any languages in this repository.')
    .setFooter({ text: `${exactNumber(total)} bytes analyzed by GitHub Linguist` });
}

const handlers = {
  user: showUser,
  repo: showRepo,
  releases: showReleases,
  commits: showCommits,
  issues: showIssues,
  languages: showLanguages,
};

module.exports = {
  data: buildCommand(),

  async execute(interaction) {
    const quiet = interaction.options.getBoolean('quiet') ?? false;
    await interaction.deferReply({ flags: quiet ? 64 : undefined });

    try {
      const subcommand = interaction.options.getSubcommand();
      const repository = subcommand === 'user'
        ? null
        : parseRepository(interaction.options.getString('repository', true));
      const embed = await handlers[subcommand](interaction, repository);
      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      await interaction.editReply({ content: `Could not fetch GitHub data: ${apiError(error)}` });
    }
  },

  githubApi,
  parseRepository,
  handlers,
};
