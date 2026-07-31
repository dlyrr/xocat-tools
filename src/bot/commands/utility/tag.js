// ============================================================
// /tag — per-server saved snippets (esmBot's tags system)
// ============================================================
const { EmbedBuilder, SlashCommandBuilder } = require('discord.js');
const { colors } = require('../../../utils/constants');
const { paginate } = require('../../../utils/pagination');
const {
  MAX_CONTENT_LENGTH,
  MAX_NAME_LENGTH,
  canModify,
  createTag,
  deleteTag,
  editTag,
  getTag,
  listTags,
  randomTag,
  recordUse,
} = require('../../../services/tagService');

const TAGS_PER_PAGE = 15;

function nameOption(subcommand, description = 'The name of the tag') {
  return subcommand.addStringOption(o => o
    .setName('name')
    .setDescription(description)
    .setRequired(true)
    .setMaxLength(MAX_NAME_LENGTH));
}

function contentOption(subcommand) {
  return subcommand.addStringOption(o => o
    .setName('content')
    .setDescription('What the tag should say')
    .setRequired(true)
    .setMaxLength(MAX_CONTENT_LENGTH));
}

function quietOption(subcommand) {
  return subcommand.addBooleanOption(o => o
    .setName('quiet')
    .setDescription('Make the response only visible to you')
    .setRequired(false));
}

module.exports = {
  prefixGreedy: 'content',
  guildOnly: true,

  data: new SlashCommandBuilder()
    .setName('tag')
    .setDescription('Save and recall named snippets of text for this server')
    .addSubcommand(sub => quietOption(nameOption(sub.setName('get').setDescription('Show a tag'))))
    .addSubcommand(sub => quietOption(contentOption(nameOption(sub.setName('add').setDescription('Create a new tag')))))
    .addSubcommand(sub => quietOption(contentOption(nameOption(sub.setName('edit').setDescription('Replace a tag\'s content')))))
    .addSubcommand(sub => quietOption(nameOption(sub.setName('remove').setDescription('Delete a tag'))))
    .addSubcommand(sub => quietOption(nameOption(sub.setName('info').setDescription('Show who owns a tag and how often it is used'))))
    .addSubcommand(sub => quietOption(sub.setName('list').setDescription('List every tag in this server')))
    .addSubcommand(sub => quietOption(sub.setName('random').setDescription('Show a random tag'))),

  // `ta` is deliberately omitted: the Last.fm alias table already claims it
  // for topartists, and that table is consulted first.
  prefixAliases: ['t', 'tags'],

  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();
    const quiet = interaction.options.getBoolean('quiet') ?? false;
    const guildId = interaction.guildId;

    if (!guildId) {
      return interaction.reply({ content: '❌ Tags are per-server, so this only works inside a server.', flags: 64 });
    }

    const reply = payload => interaction.reply(
      typeof payload === 'string'
        ? { content: payload, flags: quiet ? 64 : undefined }
        : { ...payload, flags: quiet ? 64 : undefined }
    );

    switch (subcommand) {
      case 'get': {
        const name = interaction.options.getString('name');
        const tag = getTag(guildId, name);
        if (!tag) return reply(`❌ There is no tag called \`${name}\`.`);
        recordUse(guildId, tag.name);
        // Tags are user-authored text, so never let them ping anybody.
        return interaction.reply({
          content: tag.content,
          allowedMentions: { parse: [] },
          flags: quiet ? 64 : undefined,
        });
      }

      case 'add': {
        const tag = createTag(guildId, interaction.options.getString('name'), interaction.options.getString('content'), interaction.user.id);
        return reply(`✅ Created the tag \`${tag.name}\`.`);
      }

      case 'edit': {
        const name = interaction.options.getString('name');
        const existing = getTag(guildId, name);
        if (!existing) return reply(`❌ There is no tag called \`${name}\`.`);
        if (!canModify(existing, interaction)) {
          return reply('❌ Only the tag owner or someone with Manage Messages can edit that tag.');
        }
        const tag = editTag(guildId, name, interaction.options.getString('content'));
        return reply(`✅ Updated the tag \`${tag.name}\`.`);
      }

      case 'remove': {
        const name = interaction.options.getString('name');
        const existing = getTag(guildId, name);
        if (!existing) return reply(`❌ There is no tag called \`${name}\`.`);
        if (!canModify(existing, interaction)) {
          return reply('❌ Only the tag owner or someone with Manage Messages can delete that tag.');
        }
        deleteTag(guildId, name);
        return reply(`🗑️ Deleted the tag \`${existing.name}\`.`);
      }

      case 'info': {
        const name = interaction.options.getString('name');
        const tag = getTag(guildId, name);
        if (!tag) return reply(`❌ There is no tag called \`${name}\`.`);
        const embed = new EmbedBuilder()
          .setColor(colors.utility)
          .setTitle(`Tag: ${tag.name}`)
          .addFields(
            { name: 'Owner', value: `<@${tag.author_id}>`, inline: true },
            { name: 'Uses', value: String(tag.uses ?? 0), inline: true },
            { name: 'Created', value: `<t:${Math.floor(tag.created_at / 1000)}:R>`, inline: true },
            { name: 'Last edited', value: `<t:${Math.floor(tag.updated_at / 1000)}:R>`, inline: true },
          )
          .setTimestamp();
        return interaction.reply({ embeds: [embed], allowedMentions: { parse: [] }, flags: quiet ? 64 : undefined });
      }

      case 'list': {
        const tags = listTags(guildId);
        if (!tags.length) return reply('This server has no tags yet. Create one with `/tag add`.');

        const pages = [];
        for (let index = 0; index < tags.length; index += TAGS_PER_PAGE) {
          const slice = tags.slice(index, index + TAGS_PER_PAGE);
          pages.push(new EmbedBuilder()
            .setColor(colors.utility)
            .setTitle(`Tags in ${interaction.guild?.name || 'this server'}`)
            .setDescription(slice.map(tag => `\`${tag.name}\`${tag.uses ? ` · ${tag.uses} use${tag.uses === 1 ? '' : 's'}` : ''}`).join('\n'))
            .setFooter({ text: `${tags.length} tag${tags.length === 1 ? '' : 's'}` })
            .setTimestamp());
        }

        await interaction.deferReply({ flags: quiet ? 64 : undefined });
        return paginate(interaction, pages);
      }

      case 'random': {
        const tag = randomTag(guildId);
        if (!tag) return reply('This server has no tags yet. Create one with `/tag add`.');
        recordUse(guildId, tag.name);
        return interaction.reply({
          content: `**${tag.name}**\n${tag.content}`,
          allowedMentions: { parse: [] },
          flags: quiet ? 64 : undefined,
        });
      }

      default:
        return reply('❌ Unknown subcommand.');
    }
  },
};
