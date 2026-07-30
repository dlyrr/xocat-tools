-- ============================================================
-- Discord Bot Database Schema
-- ============================================================

-- Premium users
CREATE TABLE IF NOT EXISTS premium_users (
    user_id TEXT PRIMARY KEY,
    tier TEXT DEFAULT 'premium',
    activated_at INTEGER NOT NULL,
    expires_at INTEGER  -- NULL = lifetime
);

-- User profiles / XP
CREATE TABLE IF NOT EXISTS user_profiles (
    user_id TEXT PRIMARY KEY,
    xp INTEGER DEFAULT 0,
    level INTEGER DEFAULT 1,
    commands_used INTEGER DEFAULT 0,
    last_daily INTEGER DEFAULT 0
);

-- Crypto tracking
CREATE TABLE IF NOT EXISTS crypto_tracks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    tx_hash TEXT NOT NULL,
    chain TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    created_at INTEGER NOT NULL
);

-- Timers / Reminders
CREATE TABLE IF NOT EXISTS timers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    guild_id TEXT,
    message TEXT NOT NULL,
    remind_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL
);

-- Command usage analytics
CREATE TABLE IF NOT EXISTS command_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    command TEXT NOT NULL,
    guild_id TEXT,
    used_at INTEGER NOT NULL
);

-- Game states (for persistent games like blackjack)
CREATE TABLE IF NOT EXISTS game_states (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    game_type TEXT NOT NULL,
    state TEXT NOT NULL,  -- JSON serialized game state
    channel_id TEXT NOT NULL,
    message_id TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

-- Last.fm Integration
CREATE TABLE IF NOT EXISTS lastfm_users (
    user_id TEXT PRIMARY KEY,
    lastfm_username TEXT NOT NULL
);

-- Persistent button polls
CREATE TABLE IF NOT EXISTS polls (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT,
    channel_id TEXT NOT NULL,
    message_id TEXT,
    creator_id TEXT NOT NULL,
    question TEXT NOT NULL,
    choices_json TEXT NOT NULL,
    multiple INTEGER DEFAULT 0,
    anonymous INTEGER DEFAULT 0,
    expires_at INTEGER,
    created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS poll_votes (
    poll_id INTEGER NOT NULL,
    user_id TEXT NOT NULL,
    choice_index INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (poll_id, user_id, choice_index)
);

-- Roblox update ping subscriptions (WEAO version tracker)
CREATE TABLE IF NOT EXISTS roblox_update_subs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    role_id TEXT,                 -- role to ping; NULL = no role ping
    ping_everyone INTEGER DEFAULT 0,
    platforms TEXT NOT NULL DEFAULT 'Windows,Mac,Android,iOS',
    kinds TEXT NOT NULL DEFAULT 'live,future',  -- which update channels to announce
    created_by TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    UNIQUE (guild_id, channel_id)
);

-- Opt-in personal DM subscriptions for Roblox updates
CREATE TABLE IF NOT EXISTS roblox_update_dms (
    user_id TEXT PRIMARY KEY,
    platforms TEXT NOT NULL DEFAULT 'Windows,Mac,Android,iOS',
    kinds TEXT NOT NULL DEFAULT 'live,future',
    created_at INTEGER NOT NULL
);

-- Last version seen per platform/kind so restarts never re-announce
CREATE TABLE IF NOT EXISTS roblox_update_state (
    state_key TEXT PRIMARY KEY,   -- e.g. 'live:Windows'
    hash TEXT,
    version TEXT,
    seen_at INTEGER NOT NULL
);

-- Moderation history and per-server configuration
CREATE TABLE IF NOT EXISTS moderation_cases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    action TEXT NOT NULL,
    target_id TEXT,
    moderator_id TEXT NOT NULL,
    reason TEXT,
    expires_at INTEGER,
    metadata_json TEXT,
    created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_moderation_cases_guild
    ON moderation_cases (guild_id, created_at DESC);

CREATE TABLE IF NOT EXISTS guild_settings (
    guild_id TEXT PRIMARY KEY,
    modlog_channel_id TEXT,
    report_channel_id TEXT,
    mute_role_id TEXT,
    automod_links INTEGER DEFAULT 0,
    automod_caps INTEGER DEFAULT 0,
    automod_mentions INTEGER DEFAULT 0,
    automod_repeats INTEGER DEFAULT 0,
    automod_keywords_json TEXT DEFAULT '[]',
    antiinvite INTEGER DEFAULT 0,
    antiinvite_allowed_channels_json TEXT DEFAULT '[]',
    antiinvite_allowed_roles_json TEXT DEFAULT '[]',
    antispam INTEGER DEFAULT 0,
    antispam_messages INTEGER DEFAULT 6,
    antispam_window_seconds INTEGER DEFAULT 8,
    antispam_timeout_minutes INTEGER DEFAULT 5,
    raidmode INTEGER DEFAULT 0,
    raidmode_min_account_hours INTEGER DEFAULT 72,
    raidmode_previous_verification INTEGER,
    updated_at INTEGER NOT NULL
);
