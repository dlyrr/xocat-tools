// ============================================================
// Per-server tags
// ------------------------------------------------------------
// esmBot's tag system: named snippets a server can save and recall. Names are
// stored lower-cased so lookups are case-insensitive, and the subcommand names
// are reserved so `.tag add` can never be shadowed by a tag called "add".
// ============================================================
const { dbAll, dbGet, dbRun } = require('../database/db');

const RESERVED_NAMES = new Set([
  'add', 'create', 'edit', 'update', 'remove', 'delete', 'list', 'random', 'own', 'owner', 'info', 'get',
]);

const MAX_NAME_LENGTH = 40;
const MAX_CONTENT_LENGTH = 2000;

function normalizeName(name) {
  return String(name ?? '').trim().toLowerCase();
}

function validateName(name) {
  const normalized = normalizeName(name);
  if (!normalized) throw new Error('Tag names cannot be empty.');
  if (normalized.length > MAX_NAME_LENGTH) throw new Error(`Tag names must be ${MAX_NAME_LENGTH} characters or fewer.`);
  if (RESERVED_NAMES.has(normalized)) throw new Error(`\`${normalized}\` is a reserved word, so it cannot be a tag name.`);
  if (/\s/.test(normalized)) throw new Error('Tag names cannot contain spaces.');
  return normalized;
}

function validateContent(content) {
  const trimmed = String(content ?? '').trim();
  if (!trimmed) throw new Error('Tag content cannot be empty.');
  if (trimmed.length > MAX_CONTENT_LENGTH) throw new Error(`Tag content must be ${MAX_CONTENT_LENGTH} characters or fewer.`);
  return trimmed;
}

function getTag(guildId, name) {
  return dbGet('SELECT * FROM tags WHERE guild_id = ? AND name = ?', [String(guildId), normalizeName(name)]);
}

function listTags(guildId) {
  return dbAll('SELECT name, author_id, uses FROM tags WHERE guild_id = ? ORDER BY name ASC', [String(guildId)]);
}

function countTags(guildId) {
  return dbGet('SELECT COUNT(*) AS total FROM tags WHERE guild_id = ?', [String(guildId)])?.total ?? 0;
}

function createTag(guildId, name, content, authorId) {
  const normalized = validateName(name);
  const body = validateContent(content);
  if (getTag(guildId, normalized)) throw new Error(`A tag called \`${normalized}\` already exists.`);
  const now = Date.now();
  dbRun(
    'INSERT INTO tags (guild_id, name, content, author_id, uses, created_at, updated_at) VALUES (?, ?, ?, ?, 0, ?, ?)',
    [String(guildId), normalized, body, String(authorId), now, now]
  );
  return getTag(guildId, normalized);
}

function editTag(guildId, name, content) {
  const normalized = normalizeName(name);
  const body = validateContent(content);
  const existing = getTag(guildId, normalized);
  if (!existing) throw new Error(`There is no tag called \`${normalized}\`.`);
  dbRun('UPDATE tags SET content = ?, updated_at = ? WHERE guild_id = ? AND name = ?', [body, Date.now(), String(guildId), normalized]);
  return getTag(guildId, normalized);
}

function deleteTag(guildId, name) {
  const normalized = normalizeName(name);
  dbRun('DELETE FROM tags WHERE guild_id = ? AND name = ?', [String(guildId), normalized]);
}

function recordUse(guildId, name) {
  dbRun('UPDATE tags SET uses = uses + 1 WHERE guild_id = ? AND name = ?', [String(guildId), normalizeName(name)]);
}

function randomTag(guildId) {
  const tags = listTags(guildId);
  if (!tags.length) return null;
  return getTag(guildId, tags[Math.floor(Math.random() * tags.length)].name);
}

/**
 * esmBot lets the tag owner, anyone with Manage Messages, and the bot owners
 * edit or delete a tag.
 */
function canModify(tag, interaction) {
  if (!tag) return false;
  if (tag.author_id === interaction.user.id) return true;
  const owners = String(process.env.OWNER_IDS || '').split(',').map(id => id.trim()).filter(Boolean);
  if (owners.includes(interaction.user.id)) return true;
  return !!interaction.member?.permissions?.has?.('ManageMessages');
}

module.exports = {
  MAX_CONTENT_LENGTH,
  MAX_NAME_LENGTH,
  RESERVED_NAMES,
  canModify,
  countTags,
  createTag,
  deleteTag,
  editTag,
  getTag,
  listTags,
  normalizeName,
  randomTag,
  recordUse,
  validateContent,
  validateName,
};
