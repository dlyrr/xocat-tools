const { ApplicationCommandOptionType, PermissionFlagsBits } = require('discord.js');
const { incrementCommandUsage } = require('../database/db');

const PREFIX = '.';
const LASTFM_SUBCOMMANDS = new Set([
  'set', 'np', 'remove', 'profile', 'recent', 'plays', 'overview', 'topartists',
  'topalbums', 'toptracks', 'chart', 'receipt', 'artist', 'album', 'track',
  'artistplays', 'albumplays', 'trackplays', 'albumtracks', 'cover', 'loved',
  'whoknows', 'whoknowsalbum', 'whoknowstrack',
]);

// .fmbot-compatible names for the Last.fm features this bot actually supports.
// Commands that require .fmbot's private global library are intentionally omitted.
const LASTFM_PREFIX_ALIASES = new Map(Object.entries({
  fm: 'np',
  np: 'np',
  login: 'set',
  profile: 'profile',
  stats: 'profile',
  lfm: 'profile',
  remove: 'remove',
  recent: 'recent',
  r: 'recent',
  plays: 'plays',
  p: 'plays',
  overview: 'overview',
  o: 'overview',
  topartists: 'topartists',
  ta: 'topartists',
  artists: 'topartists',
  topalbums: 'topalbums',
  tab: 'topalbums',
  toptracks: 'toptracks',
  tt: 'toptracks',
  chart: 'chart',
  c: 'chart',
  receipt: 'receipt',
  rcpt: 'receipt',
  artist: 'artist',
  a: 'artist',
  album: 'album',
  ab: 'album',
  track: 'track',
  tr: 'track',
  trackdetails: 'track',
  td: 'track',
  artistplays: 'artistplays',
  ap: 'artistplays',
  albumplays: 'albumplays',
  abp: 'albumplays',
  trackplays: 'trackplays',
  tp: 'trackplays',
  albumtracks: 'albumtracks',
  abt: 'albumtracks',
  cover: 'cover',
  co: 'cover',
  loved: 'loved',
  lt: 'loved',
  whoknows: 'whoknows',
  wk: 'whoknows',
  w: 'whoknows',
  whoknowsalbum: 'whoknowsalbum',
  wkab: 'whoknowsalbum',
  wka: 'whoknowsalbum',
  wa: 'whoknowsalbum',
  whoknowstrack: 'whoknowstrack',
  wktr: 'whoknowstrack',
  wt: 'whoknowstrack',
}));

const LASTFM_PERIOD_ALIASES = new Map(Object.entries({
  weekly: '7day',
  week: '7day',
  w: '7day',
  monthly: '1month',
  month: '1month',
  m: '1month',
  quarterly: '3month',
  quarter: '3month',
  q: '3month',
  half: '6month',
  'half-year': '6month',
  h: '6month',
  yearly: '12month',
  year: '12month',
  y: '12month',
  alltime: 'overall',
  'all-time': 'overall',
  all: 'overall',
  a: 'overall',
  overall: 'overall',
}));

const LASTFM_PRESENTATION_TOKENS = new Set([
  'embed', 'image', 'img', 'pagination', 'pages', 'page', 'billboard', 'bb',
]);

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

function optionToken(name, value) {
  return `${name}:${value}`;
}

function isUserToken(value) {
  return /^<@!?\d+>$/.test(String(value || '')) || /^\d{15,22}$/.test(String(value || ''));
}

function normalizeLastFmTokens(subcommand, inputTokens) {
  const tokens = [...inputTokens];
  const output = [subcommand];

  const takeMatching = predicate => {
    const index = tokens.findIndex(predicate);
    if (index === -1) return null;
    return tokens.splice(index, 1)[0];
  };
  const takeUser = () => {
    const value = takeMatching(isUserToken);
    if (value) output.push(optionToken('user', value));
  };
  const takeQuiet = () => {
    const value = takeMatching(token => String(token).toLowerCase() === '--quiet');
    if (value) output.push(optionToken('quiet', 'true'));
  };
  const takePeriod = () => {
    const value = takeMatching(token => LASTFM_PERIOD_ALIASES.has(String(token).toLowerCase()));
    if (value) output.push(optionToken('period', LASTFM_PERIOD_ALIASES.get(String(value).toLowerCase())));
  };
  const takeInteger = (name, min, max) => {
    const value = takeMatching(token => /^\d+$/.test(String(token)) && Number(token) >= min && Number(token) <= max);
    if (value) output.push(optionToken(name, value));
  };
  const removePresentationTokens = () => {
    for (let index = tokens.length - 1; index >= 0; index -= 1) {
      if (LASTFM_PRESENTATION_TOKENS.has(String(tokens[index]).toLowerCase())) tokens.splice(index, 1);
    }
  };
  const takeText = name => {
    const value = tokens.join(' ').trim();
    tokens.length = 0;
    if (value) output.push(optionToken(name, value));
  };
  const takeEntityPair = entityName => {
    const query = tokens.join(' ').trim();
    tokens.length = 0;
    if (!query) return;
    const separator = query.indexOf('|');
    if (separator === -1) {
      // A single natural-language query is resolved through Last.fm search.
      output.push(optionToken(entityName, query));
      return;
    }
    const artist = query.slice(0, separator).trim();
    const entity = query.slice(separator + 1).trim();
    if (artist) output.push(optionToken('artist', artist));
    if (entity) output.push(optionToken(entityName, entity));
  };

  takeQuiet();
  if ([
    'topartists', 'topalbums', 'toptracks', 'chart', 'receipt',
    'whoknows', 'whoknowsalbum', 'whoknowstrack',
  ].includes(subcommand)) removePresentationTokens();

  if (subcommand === 'set') {
    takeText('username');
  } else if (['np', 'profile'].includes(subcommand)) {
    takeUser();
    tokens.length = 0; // .fm allows trailing text just like .fmbot.
  } else if (subcommand === 'remove') {
    tokens.length = 0;
  } else if (subcommand === 'recent') {
    takeUser();
    takeInteger('limit', 1, 25);
    takeText('artist');
  } else if (subcommand === 'plays') {
    takeUser();
    takePeriod();
    if (tokens.length) output.push(optionToken('period', tokens.join(' ')));
  } else if (subcommand === 'overview') {
    takeUser();
    takeInteger('days', 1, 8);
    if (tokens.length) output.push(optionToken('days', tokens.join(' ')));
  } else if (['topartists', 'topalbums', 'toptracks'].includes(subcommand)) {
    takeUser();
    takePeriod();
    takeInteger('limit', 1, 25);
    if (tokens.length) output.push(optionToken('period', tokens.join(' ')));
  } else if (subcommand === 'chart') {
    takeUser();
    const size = takeMatching(token => /^[3-6]x[3-6]$/i.test(String(token)));
    if (size) output.push(optionToken('size', String(size).toLowerCase()));
    takePeriod();
    if (tokens.length) output.push(optionToken('period', tokens.join(' ')));
  } else if (subcommand === 'receipt') {
    takeUser();
    takePeriod();
    if (tokens.length) output.push(optionToken('period', tokens.join(' ')));
  } else if (['artist', 'artistplays'].includes(subcommand)) {
    takeUser();
    takeText('artist');
  } else if (subcommand === 'whoknows') {
    takeText('artist');
  } else if (['album', 'albumplays', 'albumtracks', 'cover'].includes(subcommand)) {
    takeUser();
    takeEntityPair('album');
  } else if (subcommand === 'whoknowsalbum') {
    takeEntityPair('album');
  } else if (['track', 'trackplays'].includes(subcommand)) {
    takeUser();
    takeEntityPair('track');
  } else if (subcommand === 'whoknowstrack') {
    takeEntityPair('track');
  } else if (subcommand === 'loved') {
    takeUser();
    takeInteger('limit', 1, 25);
  }

  return output;
}

function applyAliases(name, tokens) {
  if (name === 'lastfm') {
    const requested = String(tokens[0] || '').toLowerCase();
    const subcommand = LASTFM_SUBCOMMANDS.has(requested)
      ? requested
      : LASTFM_PREFIX_ALIASES.get(requested);
    if (subcommand) return { name: 'lastfm', tokens: normalizeLastFmTokens(subcommand, tokens.slice(1)) };
    return { name: 'lastfm', tokens: normalizeLastFmTokens('profile', tokens) };
  }

  const subcommand = LASTFM_PREFIX_ALIASES.get(name);
  if (subcommand) return { name: 'lastfm', tokens: normalizeLastFmTokens(subcommand, tokens) };
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
      return message.attachments.first() || null;
    default:
      return raw;
  }
}

async function parseOptions(message, schemaOptions, tokens) {
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
    let raw = named.has(option.name) ? named.get(option.name) : positional[cursor];
    if (raw !== undefined && !named.has(option.name)) cursor += 1;
    if (option.type === ApplicationCommandOptionType.Attachment && raw === undefined && message.attachments.size) raw = '__attachment__';
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
  const alias = applyAliases(tokens.shift().toLowerCase(), tokens);
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
    const values = await parseOptions(message, selected.options, selected.tokens);
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
  LASTFM_PREFIX_ALIASES,
  PREFIX,
  PrefixInteraction,
  applyAliases,
  handlePrefixCommand,
  normalizeLastFmTokens,
  parseOptions,
  selectSchema,
  tokenize,
};
