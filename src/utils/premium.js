// ============================================================
// Premium Check Utility
// ============================================================
const { dbGet } = require('../database/db');

function isPremium(userId) {
  // Check environment variable list
  const envPremium = (process.env.PREMIUM_USER_IDS || '').split(',').map(id => id.trim()).filter(Boolean);
  if (envPremium.includes(userId)) return true;

  // Check owners (owners always have premium)
  const owners = (process.env.OWNER_IDS || '').split(',').map(id => id.trim()).filter(Boolean);
  if (owners.includes(userId)) return true;

  // Check database
  try {
    const row = dbGet('SELECT * FROM premium_users WHERE user_id = ? AND (expires_at IS NULL OR expires_at > ?)', [userId, Date.now()]);
    if (row) return true;
  } catch {}

  return false;
}

function isOwner(userId) {
  const owners = (process.env.OWNER_IDS || '').split(',').map(id => id.trim()).filter(Boolean);
  return owners.includes(userId);
}

function isWhitelisted(userId) {
  return isOwner(userId) || isPremium(userId);
}

module.exports = { isPremium, isOwner, isWhitelisted };
