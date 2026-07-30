// ============================================================
// /robloxupdates — subscribe a channel to WEAO Roblox update pings
// ============================================================
const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const { colors } = require('../../../utils/constants');
const { dbAll, dbGet, dbRun } = require('../../../database/db');
const {
  buildUpdateMessage,
  readPlatform,
  fetchVersions,
  PLATFORMS,
} = require('../../../services/robloxUpdateService');

const PLATFORM_PRESETS = {
  all: 'Windows,Mac,Android,iOS',
  desktop: 'Windows,Mac',
  windows: 'Windows',
  mac: 'Mac',
  android: 'Android',
  ios: 'iOS',
};

const KIND_PRESETS = {
  both: 'live,future',
  live: 'live',
  future: 'future',
};

function describeSub(sub) {
  const ping = [];
  if (sub.ping_everyone) ping.push('@everyone');
  if (sub.role_id) ping.push(`<@&${sub.role_id}>`);

  return [
    `> Platforms: \`${sub.platforms}\``,
    `> Updates: \`${sub.kinds}\``,
    `> Ping: ${ping.join(' ') || '`none`'}`,
  ].join('\n');
}

// Server-wide configuration is limited to admins; `dm` and `test` are open to
// anyone, so the gate lives in execute() rather than on the whole command.
const ADMIN_SUBCOMMANDS = new Set(['setup', 'remove', 'list']);

module.exports = {
  data: new SlashCommandBuilder()
    .setName('robloxupdates')
    .setDescription('Get pinged whenever Roblox updates (powered by WEAO)')
    .addSubcommand(s => s
      .setName('setup')
      .setDescription('Announce Roblox updates in a channel')
      .addChannelOption(o => o
        .setName('channel')
        .setDescription('Where update announcements are posted')
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        .setRequired(true))
      .addRoleOption(o => o
        .setName('role')
        .setDescription('Role to ping on every update'))
      .addStringOption(o => o
        .setName('platforms')
        .setDescription('Which platforms to watch (default: all)')
        .addChoices(
          { name: 'All platforms', value: 'all' },
          { name: 'Windows & Mac', value: 'desktop' },
          { name: 'Windows only', value: 'windows' },
          { name: 'Mac only', value: 'mac' },
          { name: 'Android only', value: 'android' },
          { name: 'iOS only', value: 'ios' },
        ))
      .addStringOption(o => o
        .setName('updates')
        .setDescription('Live updates patch exploits; future updates are upcoming builds (default: both)')
        .addChoices(
          { name: 'Live and future updates', value: 'both' },
          { name: 'Live updates only', value: 'live' },
          { name: 'Future updates only', value: 'future' },
        ))
      .addBooleanOption(o => o
        .setName('everyone')
        .setDescription('Ping @everyone on every update (off by default)'))
    )
    .addSubcommand(s => s
      .setName('remove')
      .setDescription('Stop announcing Roblox updates in a channel')
      .addChannelOption(o => o
        .setName('channel')
        .setDescription('The channel to unsubscribe')
        .setRequired(true))
    )
    .addSubcommand(s => s
      .setName('list')
      .setDescription('Show this server\'s Roblox update subscriptions')
    )
    .addSubcommand(s => s
      .setName('dm')
      .setDescription('Get Roblox updates sent straight to your DMs')
      .addBooleanOption(o => o
        .setName('enabled')
        .setDescription('Turn your personal DM pings on or off')
        .setRequired(true))
      .addStringOption(o => o
        .setName('platforms')
        .setDescription('Which platforms to watch (default: all)')
        .addChoices(
          { name: 'All platforms', value: 'all' },
          { name: 'Windows & Mac', value: 'desktop' },
          { name: 'Windows only', value: 'windows' },
          { name: 'Mac only', value: 'mac' },
          { name: 'Android only', value: 'android' },
          { name: 'iOS only', value: 'ios' },
        ))
      .addStringOption(o => o
        .setName('updates')
        .setDescription('Live updates patch exploits; future updates are upcoming builds (default: both)')
        .addChoices(
          { name: 'Live and future updates', value: 'both' },
          { name: 'Live updates only', value: 'live' },
          { name: 'Future updates only', value: 'future' },
        ))
    )
    .addSubcommand(s => s
      .setName('test')
      .setDescription('Post a sample announcement using the current Roblox version')
      .addStringOption(o => o
        .setName('platform')
        .setDescription('Platform to preview (default: Windows)')
        .addChoices(
          { name: 'Windows', value: 'Windows' },
          { name: 'Mac', value: 'Mac' },
          { name: 'Android', value: 'Android' },
          { name: 'iOS', value: 'iOS' },
        ))
      .addStringOption(o => o
        .setName('updates')
        .setDescription('Which announcement style to preview (default: live)')
        .addChoices(
          { name: 'Live update', value: 'live' },
          { name: 'Future update', value: 'future' },
        ))
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    if (ADMIN_SUBCOMMANDS.has(sub)) {
      if (!interaction.inGuild()) {
        return interaction.reply({
          content: 'That only works inside a server. Use `/robloxupdates dm enabled:True` to get updates here instead.',
          flags: 64,
        });
      }
      if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
        return interaction.reply({
          content: 'You need the **Manage Server** permission to change this server\'s Roblox update pings. You can still use `/robloxupdates dm enabled:True` for your own DMs.',
          flags: 64,
        });
      }
    }
    // Config replies stay ephemeral; the preview is posted publicly so admins
    // can see exactly what the server will get.
    await interaction.deferReply(sub === 'test' ? {} : { flags: 64 });

    if (sub === 'setup') {
      const channel = interaction.options.getChannel('channel');
      const role = interaction.options.getRole('role');
      const platforms = PLATFORM_PRESETS[interaction.options.getString('platforms') || 'all'];
      const kinds = KIND_PRESETS[interaction.options.getString('updates') || 'both'];
      const pingEveryone = interaction.options.getBoolean('everyone') ? 1 : 0;

      const me = await interaction.guild.members.fetchMe();
      const perms = channel.permissionsFor(me);
      if (!perms?.has(PermissionFlagsBits.ViewChannel) || !perms?.has(PermissionFlagsBits.SendMessages)) {
        return interaction.editReply(`I can't send messages in ${channel}. Grant me **View Channel** and **Send Messages** there first.`);
      }
      if (pingEveryone && !perms.has(PermissionFlagsBits.MentionEveryone)) {
        return interaction.editReply(`I need **Mention @everyone** in ${channel} to ping everyone. Grant it or re-run without \`everyone\`.`);
      }

      dbRun(
        'INSERT INTO roblox_update_subs (guild_id, channel_id, role_id, ping_everyone, platforms, kinds, created_by, created_at) ' +
        'VALUES (?, ?, ?, ?, ?, ?, ?, ?) ' +
        'ON CONFLICT(guild_id, channel_id) DO UPDATE SET ' +
        'role_id = excluded.role_id, ping_everyone = excluded.ping_everyone, ' +
        'platforms = excluded.platforms, kinds = excluded.kinds, created_by = excluded.created_by',
        [interaction.guildId, channel.id, role?.id || null, pingEveryone, platforms, kinds, interaction.user.id, Date.now()]
      );

      const saved = dbGet('SELECT * FROM roblox_update_subs WHERE guild_id = ? AND channel_id = ?', [interaction.guildId, channel.id]);

      const embed = new EmbedBuilder()
        .setColor(colors.roblox)
        .setTitle('Roblox update pings enabled')
        .setDescription(`Updates will be announced in ${channel}.\n\n${describeSub(saved)}`)
        .setFooter({ text: 'Powered by WEAO, The #1 Roblox exploit status tracker' });

      return interaction.editReply({ embeds: [embed] });
    }

    if (sub === 'remove') {
      const channel = interaction.options.getChannel('channel');
      const existing = dbGet('SELECT * FROM roblox_update_subs WHERE guild_id = ? AND channel_id = ?', [interaction.guildId, channel.id]);
      if (!existing) {
        return interaction.editReply(`${channel} isn't subscribed to Roblox updates.`);
      }

      dbRun('DELETE FROM roblox_update_subs WHERE id = ?', [existing.id]);
      return interaction.editReply(`Roblox update pings disabled for ${channel}.`);
    }

    if (sub === 'list') {
      const subs = dbAll('SELECT * FROM roblox_update_subs WHERE guild_id = ? ORDER BY id', [interaction.guildId]);
      if (!subs.length) {
        return interaction.editReply('No channels are subscribed yet. Use `/robloxupdates setup` to start.');
      }

      const embed = new EmbedBuilder()
        .setColor(colors.roblox)
        .setTitle('Roblox update subscriptions')
        .setFooter({ text: 'Powered by WEAO, The #1 Roblox exploit status tracker' })
        .addFields(subs.slice(0, 25).map((s, index) => ({
          name: `${index + 1}. Channel`,
          value: `<#${s.channel_id}>\n${describeSub(s)}`,
          inline: false,
        })));

      return interaction.editReply({ embeds: [embed] });
    }

    if (sub === 'dm') {
      const enabled = interaction.options.getBoolean('enabled');

      if (!enabled) {
        const existing = dbGet('SELECT * FROM roblox_update_dms WHERE user_id = ?', [interaction.user.id]);
        if (!existing) return interaction.editReply('You weren\'t subscribed to Roblox update DMs.');
        dbRun('DELETE FROM roblox_update_dms WHERE user_id = ?', [interaction.user.id]);
        return interaction.editReply('Roblox update DMs turned off. Re-enable them any time with `/robloxupdates dm enabled:True`.');
      }

      const platforms = PLATFORM_PRESETS[interaction.options.getString('platforms') || 'all'];
      const kinds = KIND_PRESETS[interaction.options.getString('updates') || 'both'];

      // Confirm the DM channel actually opens before promising delivery —
      // closed DMs would otherwise fail silently at announcement time.
      try {
        await interaction.user.createDM();
      } catch {
        return interaction.editReply('I can\'t DM you. Enable **Direct Messages** for this server in your privacy settings, then try again.');
      }

      dbRun(
        'INSERT INTO roblox_update_dms (user_id, platforms, kinds, created_at) VALUES (?, ?, ?, ?) ' +
        'ON CONFLICT(user_id) DO UPDATE SET platforms = excluded.platforms, kinds = excluded.kinds',
        [interaction.user.id, platforms, kinds, Date.now()]
      );

      const saved = dbGet('SELECT * FROM roblox_update_dms WHERE user_id = ?', [interaction.user.id]);

      const embed = new EmbedBuilder()
        .setColor(colors.roblox)
        .setTitle('Roblox update DMs enabled')
        .setDescription(`I'll DM you every time Roblox updates.\n\n> Platforms: \`${saved.platforms}\`\n> Updates: \`${saved.kinds}\``)
        .setFooter({ text: 'Powered by WEAO, The #1 Roblox exploit status tracker' });

      return interaction.editReply({ embeds: [embed] });
    }

    if (sub === 'test') {
      const kind = interaction.options.getString('updates') || 'live';
      const platform = interaction.options.getString('platform') || 'Windows';

      if (!PLATFORMS[kind].includes(platform)) {
        return interaction.editReply({
          content: `WEAO only tracks ${PLATFORMS[kind].join(' and ')} for **${kind}** updates.`,
          flags: 64,
        });
      }

      let payload;
      try {
        payload = await fetchVersions(kind);
      } catch (error) {
        return interaction.editReply(`Could not reach the WEAO API: \`${error.message}\``);
      }

      const update = readPlatform(payload, platform);
      if (!update) {
        return interaction.editReply(`WEAO has no ${kind} version data for **${platform}** right now.`);
      }

      return interaction.editReply(buildUpdateMessage(kind, update));
    }

    return interaction.editReply('Unknown subcommand.');
  },
};
