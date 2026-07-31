const os = require('os');
const { EmbedBuilder, SlashCommandBuilder } = require('discord.js');
const { colors } = require('../../../utils/constants');

function formatDuration(totalSeconds) {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remaining = seconds % 60;
  return [days && `${days}d`, (days || hours) && `${hours}h`, (days || hours || minutes) && `${minutes}m`, `${remaining}s`].filter(Boolean).join(' ');
}

const bytes = value => `${(value / 1024 / 1024).toFixed(1)} MB`;

module.exports = {
  prefixAliases: ['up'],
  data: new SlashCommandBuilder()
    .setName('uptime')
    .setDescription('Show bot uptime, memory use, commands, and process statistics')
    .addBooleanOption(o => o.setName('quiet').setDescription('Make the response only visible to you')),

  async execute(interaction) {
    const quiet = interaction.options.getBoolean('quiet') ?? false;
    const memory = process.memoryUsage();
    const usage = process.resourceUsage();
    const embed = new EmbedBuilder()
      .setColor(colors.utility)
      .setTitle('Bot runtime')
      .setDescription(`Online for **${formatDuration(process.uptime())}**`)
      .addFields(
        { name: 'Commands', value: interaction.client.commands.size.toLocaleString(), inline: true },
        { name: 'Servers', value: interaction.client.guilds.cache.size.toLocaleString(), inline: true },
        { name: 'WebSocket', value: `${Math.round(interaction.client.ws.ping)} ms`, inline: true },
        { name: 'Memory', value: `RSS: **${bytes(memory.rss)}**\nHeap: **${bytes(memory.heapUsed)} / ${bytes(memory.heapTotal)}**`, inline: true },
        { name: 'Process', value: `Node: **${process.version}**\nPID: **${process.pid}**`, inline: true },
        { name: 'CPU time', value: `User: **${(usage.userCPUTime / 1e6).toFixed(2)}s**\nSystem: **${(usage.systemCPUTime / 1e6).toFixed(2)}s**`, inline: true },
        { name: 'Host', value: `${os.platform()} ${os.arch()} · ${os.cpus().length} logical CPUs`, inline: false },
      )
      .setTimestamp();
    return interaction.reply({ embeds: [embed], flags: quiet ? 64 : undefined });
  },

  formatDuration,
};
