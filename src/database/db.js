// ============================================================
// SQLite Database Connection & Initialization (sql.js — pure JS)
// ============================================================
const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

let db = null;
let dbPath = null;

async function initDatabase() {
  const SQL = await initSqlJs();
  dbPath = path.join(__dirname, '..', '..', 'bot.db');

  // Load existing database or create new
  if (fs.existsSync(dbPath)) {
    const buffer = fs.readFileSync(dbPath);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
  }

  // Run schema
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf-8');
  db.run(schema);

  // Auto-save every 30 seconds
  setInterval(() => saveDatabase(), 30000);

  logger.success('database', `SQLite ready · ${path.basename(dbPath)}`);
  return db;
}

function saveDatabase() {
  if (!db || !dbPath) return;
  try {
    const data = db.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(dbPath, buffer);
  } catch (err) {
    logger.error('database', 'Could not save SQLite database', err);
  }
}

function getDatabase() {
  if (!db) throw new Error('Database not initialized. Call initDatabase() first.');
  return db;
}

// Helper: run a query and return results
function dbAll(sql, params = []) {
  const stmt = db.prepare(sql);
  if (params.length) stmt.bind(params);
  const results = [];
  while (stmt.step()) results.push(stmt.getAsObject());
  stmt.free();
  return results;
}

function dbGet(sql, params = []) {
  const results = dbAll(sql, params);
  return results[0] || null;
}

function dbRun(sql, params = []) {
  db.run(sql, params);
  saveDatabase();
  return { changes: db.getRowsModified() };
}

// Profile helpers
function getOrCreateProfile(userId) {
  let profile = dbGet('SELECT * FROM user_profiles WHERE user_id = ?', [userId]);
  if (!profile) {
    dbRun('INSERT INTO user_profiles (user_id, xp, level, commands_used, last_daily) VALUES (?, 0, 1, 0, 0)', [userId]);
    profile = dbGet('SELECT * FROM user_profiles WHERE user_id = ?', [userId]);
  }
  return profile;
}

function incrementCommandUsage(userId, commandName, guildId) {
  // Upsert user profile
  const existing = dbGet('SELECT * FROM user_profiles WHERE user_id = ?', [userId]);
  if (existing) {
    dbRun('UPDATE user_profiles SET commands_used = commands_used + 1, xp = xp + 5 WHERE user_id = ?', [userId]);
  } else {
    dbRun('INSERT INTO user_profiles (user_id, xp, level, commands_used, last_daily) VALUES (?, 5, 1, 1, 0)', [userId]);
  }

  // Log command usage
  dbRun('INSERT INTO command_logs (user_id, command, guild_id, used_at) VALUES (?, ?, ?, ?)',
    [userId, commandName, guildId, Date.now()]);

  // Check for level up
  const profile = dbGet('SELECT * FROM user_profiles WHERE user_id = ?', [userId]);
  if (profile) {
    const xpNeeded = profile.level * 100;
    if (profile.xp >= xpNeeded) {
      dbRun('UPDATE user_profiles SET level = level + 1 WHERE user_id = ?', [userId]);
    }
  }
}

module.exports = { initDatabase, getDatabase, saveDatabase, dbAll, dbGet, dbRun, getOrCreateProfile, incrementCommandUsage };
