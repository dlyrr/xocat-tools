const { ApplicationCommandOptionType, PermissionFlagsBits } = require('discord.js');
const { incrementCommandUsage } = require('../database/db');
const { listEffects } = require('./imageEffects');

const PREFIX = '.';

function tokenize(input) {
  const tokens = [];
  let current = '';
  let quote = null;
  let escaped = false;
  for (const character of String(input || '')) {
    if (escaped) {
      current += character;
      escaped = false;
    } else if (character === '\\') {
      escaped = true;
    } else if (quote) {
      if (character === quote) quote = null;
      else current += character;
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (/\s/.test(character)) {
      if (current) tokens.push(current);
      current = '';
    } else {
      current += character;
    }
  }
  if (escaped) current += '\\';
  if (current) tokens.push(current);
  return tokens;
}

/**
 * Build the prefix alias table for a client.
 *
 * Two sources feed it, in priority order:
 *   1. `prefixAliases` exported by a command module, optionally with leading
 *      tokens to prepend (`.haah` -> `/mirror direction:haah`)
 *   2. every image effect name/alias, routed to `/image` with the effect
 *      pre-filled — this is what makes `.deepfry`, `.magik`, `.spin` and the
 *      rest work the way they do in esmBot
 *
 * A real command name always wins, so `.caption` keeps running /caption.
 */
function buildAliasRegistry(client) {
  const registry = new Map();

  for (const [, command] of client.commands) {
    const target = command.data?.name;
    if (!target) continue;
    for (const alias of command.prefixAliases || []) {
      // An alias is either a bare name or { alias, prepend }, where prepend
      // supplies leading tokens — that is how `.haah` reaches /mirror with the
      // direction already chosen.
      const name = typeof alias === 'string' ? alias : alias.alias;
      const prepend = typeof alias === 'string' ? undefined : alias.prepend;
      const key = String(name).toLowerCase();
      if (client.commands.has(key) || registry.has(key)) continue;
      registry.set(key, { name: target, prepend });
    }
  }

  if (client.commands.has('image')) {
    for (const effect of listEffects()) {
      for (const alias of [effect.name, ...(effect.aliases || [])]) {
        const key = String(alias).toLowerCase();
        if (client.commands.has(key) || registry.has(key)) continue;
        registry.set(key, { name: 'image', prepend: [effect.name] });
      }
    }
  }

  return registry;
}

function getAliasRegistry(client) {
  if (!client.prefixAliasRegistry) client.prefixAliasRegistry = buildAliasRegistry(client);
  return client.prefixAliasRegistry;
}

function applyAliases(name, tokens, registry = null) {
  const mapped = registry?.get(name);
  if (mapped) return { name: mapped.name, tokens: [...(mapped.prepend || []), ...tokens] };

  return { name, tokens };
}

function selectSchema(commandData, tokens) {
  let options = commandData.options || [];
  let group = null;
  let subcommand = null;
  let cursor = 0;
  const first = options.find(option => option.name === String(tokens[cursor] || '').toLowerCase());
  if (first?.type === ApplicationCommandOptionType.SubcommandGroup) {
    group = first.name;
    cursor += 1;
    options = first.options || [];
  }
  const selected = options.find(option => option.name === String(tokens[cursor] || '').toLowerCase());
  if (selected?.type === ApplicationCommandOptionType.Subcommand) {
    subcommand = selected.name;
    cursor += 1;
    options = selected.options || [];
  } else if (options.some(option => option.type === ApplicationCommandOptionType.Subcommand)) {
    throw new Error(`Choose a subcommand: ${options.filter(option => option.type === ApplicationCommandOptionType.Subcommand).map(option => `\`${option.name}\``).join(', ')}`);
  }
  return { group, subcommand, options, tokens: tokens.slice(cursor) };
}

function parseBoolean(value) {
  if (/^(true|yes|on|1)$/i.test(value)) return true;
  if (/^(false|no|off|0)$/i.test(value)) return false;
  throw new Error(`\`${value}\` is not a boolean; use true or false.`);
}

async function resolveValue(message, option, raw) {
  switch (option.type) {
    case ApplicationCommandOptionType.String:
      return String(raw);
    case ApplicationCommandOptionType.Integer: {
      const value = Number(raw);
      if (!Number.isInteger(value)) throw new Error(`\`${option.name}\` must be a whole number.`);
      return value;
    }
    case ApplicationCommandOptionType.Number: {
      const value = Number(raw);
      if (!Number.isFinite(value)) throw new Error(`\`${option.name}\` must be a number.`);
      return value;
    }
    case ApplicationCommandOptionType.Boolean:
      return parseBoolean(raw);
    case ApplicationCommandOptionType.User: {
      const id = String(raw).match(/^<@!?(\d+)>$/)?.[1] || (/^\d+$/.test(raw) ? raw : null);
      if (!id) throw new Error(`\`${option.name}\` must be a user mention or Discord user ID.`);
      return message.client.users.fetch(id);
    }
    case ApplicationCommandOptionType.Channel: {
      const id = String(raw).match(/^<#(\d+)>$/)?.[1] || (/^\d+$/.test(raw) ? raw : null);
      if (!id) throw new Error(`\`${option.name}\` must be a channel mention or ID.`);
      return message.guild?.channels.fetch(id);
    }
    case ApplicationCommandOptionType.Role: {
      const id = String(raw).match(/^<@&(\d+)>$/)?.[1] || (/^\d+$/.test(raw) ? raw : null);
      if (!id) throw new Error(`\`${option.name}\` must be a role mention or ID.`);
      return message.guild?.roles.fetch(id);
    }
    case ApplicationCommandOptionType.Mentionable: {
      const roleId = String(raw).match(/^<@&(\d+)>$/)?.[1];
      if (roleId) return message.guild?.roles.fetch(roleId);
      const userId = String(raw).match(/^<@!?(\d+)>$/)?.[1];
      if (userId) return message.client.users.fetch(userId);
      throw new Error(`\`${option.name}\` must be a user or role mention.`);
    }
    case ApplicationCommandOptionType.Attachment:
      return resolveAttachment(message);
    default:
      return raw;
  }
}

/**
 * Attachments cannot be typed as text, so they come from the message itself —
 * either the invoking message or, failing that, the message it replies to.
 */
async function resolveAttachment(message) {
  if (message.attachments?.size) return message.attachments.first();

  const reference = message.reference || message.messageReference;
  const referencedId = reference?.messageId || reference?.messageID;
  if (!referencedId) return null;

  const replied = await message.channel?.messages?.fetch(referencedId).catch(() => null);
  return replied?.attachments?.first() || null;
}

async function parseOptions(message, schemaOptions, tokens, options = {}) {
  const greedy = options.greedy ? String(options.greedy).toLowerCase() : null;

  const named = new Map();
  const positional = [];
  for (const token of tokens) {
    const match = token.match(/^([a-z0-9_-]+):(.*)$/i);
    if (match && schemaOptions.some(option => option.name === match[1].toLowerCase())) named.set(match[1].toLowerCase(), match[2]);
    else positional.push(token);
  }

  const values = new Map();
  let cursor = 0;
  for (const option of schemaOptions) {
    if ([ApplicationCommandOptionType.Subcommand, ApplicationCommandOptionType.SubcommandGroup].includes(option.type)) continue;

    // Attachment options never consume a positional token — there is nothing a
    // user could type there — so they must not shift the cursor.
    if (option.type === ApplicationCommandOptionType.Attachment) {
      const attachment = await resolveAttachment(message);
      if (!attachment && option.required) throw new Error(`Attach a file for \`${option.name}\`, or reply to a message that has one.`);
      values.set(option.name, attachment || null);
      continue;
    }

    let raw = named.has(option.name) ? named.get(option.name) : positional[cursor];
    if (raw !== undefined && !named.has(option.name)) {
      if (option.name === greedy) {
        // Soak up the rest of the line so captions do not need quoting.
        raw = positional.slice(cursor).join(' ');
        cursor = positional.length;
      } else {
        cursor += 1;
      }
    }
    if (raw === undefined || raw === '') {
      if (option.required) throw new Error(`Missing required option \`${option.name}\`.`);
      values.set(option.name, null);
      continue;
    }
    const value = await resolveValue(message, option, raw);
    if (option.choices?.length && !option.choices.some(choice => String(choice.value) === String(value))) {
      throw new Error(`\`${option.name}\` must be one of: ${option.choices.map(choice => `\`${choice.value}\``).join(', ')}`);
    }
    if (typeof value === 'number') {
      if (option.min_value !== undefined && value < option.min_value) throw new Error(`\`${option.name}\` must be at least ${option.min_value}.`);
      if (option.max_value !== undefined && value > option.max_value) throw new Error(`\`${option.name}\` must be at most ${option.max_value}.`);
    }
    values.set(option.name, value);
  }
  if (cursor < positional.length) throw new Error(`Unexpected argument: \`${positional[cursor]}\`. Put multi-word values in quotes.`);
  return values;
}

function cleanPayload(payload) {
  if (typeof payload === 'string') return { content: payload, allowedMentions: { repliedUser: false } };
  const { flags, ephemeral, fetchReply, ...rest } = payload || {};
  return { ...rest, allowedMentions: rest.allowedMentions || { repliedUser: false } };
}

class PrefixInteraction {
  constructor(message, commandName, group, subcommand, values) {
    this.message = message;
    this.commandName = commandName;
    this.client = message.client;
    this.user = message.author;
    this.member = message.member;
    this.guild = message.guild;
    this.guildId = message.guildId;
    this.channel = message.channel;
    this.channelId = message.channelId;
    this.createdTimestamp = message.createdTimestamp;
    this.deferred = false;
    this.replied = false;
    this.responseMessage = null;
    this.options = {
      getSubcommand: required => subcommand || (required === false ? null : (() => { throw new Error('This command requires a subcommand.'); })()),
      getSubcommandGroup: required => group || (required === false ? null : (() => { throw new Error('This command has no subcommand group.'); })()),
      getString: (name, required) => this.getOption(values, name, required),
      getInteger: (name, required) => this.getOption(values, name, required),
      getNumber: (name, required) => this.getOption(values, name, required),
      getBoolean: (name, required) => this.getOption(values, name, required),
      getUser: (name, required) => this.getOption(values, name, required),
      getChannel: (name, required) => this.getOption(values, name, required),
      getRole: (name, required) => this.getOption(values, name, required),
      getMentionable: (name, required) => this.getOption(values, name, required),
      getAttachment: (name, required) => this.getOption(values, name, required),
      getMember: name => {
        const user = values.get(name);
        return user && message.guild ? message.guild.members.cache.get(user.id) || null : null;
      },
    };
  }

  getOption(values, name, required) {
    const value = values.get(name) ?? null;
    if (required && value === null) throw new Error(`Missing required option \`${name}\`.`);
    return value;
  }

  async deferReply() {
    this.deferred = true;
    await this.channel.sendTyping().catch(() => {});
  }

  async reply(payload) {
    this.responseMessage = await this.message.reply(cleanPayload(payload));
    this.replied = true;
    return this.responseMessage;
  }

  async editReply(payload) {
    if (!this.responseMessage) {
      this.responseMessage = await this.message.reply(cleanPayload(payload));
      this.replied = true;
      return this.responseMessage;
    }
    return this.responseMessage.edit(cleanPayload(payload));
  }

  async followUp(payload) {
    return this.channel.send(cleanPayload(payload));
  }

  async fetchReply() {
    return this.responseMessage;
  }

  async deleteReply() {
    if (this.responseMessage) await this.responseMessage.delete();
  }
}

async function handlePrefixCommand(message) {
  if (!message.content?.startsWith(PREFIX) || message.content.startsWith('..') || message.author.bot) return false;
  const tokens = tokenize(message.content.slice(PREFIX.length).trim());
  if (!tokens.length) return false;
  const alias = applyAliases(tokens.shift().toLowerCase(), tokens, getAliasRegistry(message.client));
  const command = message.client.commands.get(alias.name);
  if (!command) return false;

  try {
    if (command.guildOnly && !message.guild) throw new Error('This command can only be used in a server.');
    const data = command.data.toJSON();
    if (data.default_member_permissions && message.member) {
      const required = BigInt(data.default_member_permissions);
      if (!message.member.permissions.has(required)) throw new Error('You do not have permission to use this command.');
    }
    const selected = selectSchema(data, alias.tokens);
    const values = await parseOptions(message, selected.options, selected.tokens, { greedy: command.prefixGreedy });
    const interaction = new PrefixInteraction(message, alias.name, selected.group, selected.subcommand, values);
    await command.execute(interaction);
    try {
      incrementCommandUsage(message.author.id, `${PREFIX}${alias.name}${selected.group ? ` ${selected.group}` : ''}${selected.subcommand ? ` ${selected.subcommand}` : ''}`, message.guildId);
    } catch (error) {
      console.error('[PREFIX] Could not record command usage:', error);
    }
  } catch (error) {
    const detail = String(error?.message || error).replace(/```/g, "''' ").slice(0, 1600);
    await message.reply({ content: `Could not run that command: ${detail}`, allowedMentions: { repliedUser: false } }).catch(() => {});
  }
  return true;
}

module.exports = {
  PREFIX,
  PrefixInteraction,
  applyAliases,
  buildAliasRegistry,
  getAliasRegistry,
  handlePrefixCommand,
  parseOptions,
  resolveAttachment,
  selectSchema,
  tokenize,
};
