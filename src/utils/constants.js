// ============================================================
// Discord Multi-Feature Bot — Constants
// ============================================================

module.exports = {
  // Embed colors
  colors: {
    primary: 0x7C3AED,    // Primary violet
    secondary: 0xA78BFA,  // Secondary violet
    accent: 0xF43F5E,     // Rose accent
    muted: 0x27273B,      // Dark neutral
    success: 0x22C55E,    // Green
    error: 0xEF4444,      // Red
    warning: 0xF59E0B,    // Amber
    info: 0xA78BFA,       // Soft violet
    premium: 0xD946EF,    // Magenta
    roblox: 0xE2231A,     // Roblox red
    applemusic: 0xFA243C, // Apple Music red
    crypto: 0xF7931A,     // Bitcoin orange
    ai: 0xA78BFA,         // Purple for AI
    fun: 0xF43F5E,        // Rose for games and fun
    social: 0xEC4899,     // Pink for social
    finance: 0x14B8A6,    // Teal for finance
    admin: 0x94A3B8,      // Slate for admin
    utility: 0x60A5FA,    // Blue for utility
  },

  // Emojis
  emojis: {
    premium: '💎',
    success: '✅',
    error: '❌',
    warning: '⚠️',
    loading: '⏳',
    roblox: '🎮',
    ai: '🤖',
    music: '🎵',
    crypto: '💰',
    fire: '🔥',
    star: '⭐',
    arrow_right: '▶️',
    arrow_left: '◀️',
    chart_up: '📈',
    chart_down: '📉',
    globe: '🌍',
    lock: '🔒',
    unlock: '🔓',
    dice: '🎲',
    trophy: '🏆',
    clock: '⏰',
    link: '🔗',
    image: '🖼️',
    search: '🔍',
    info: 'ℹ️',
    heart: '❤️',
    cookie: '🍪',
  },

  // Roblox API base URLs
  robloxAPIs: {
    users: 'https://users.roblox.com',
    friends: 'https://friends.roblox.com',
    catalog: 'https://catalog.roblox.com',
    games: 'https://games.roblox.com',
    thumbnails: 'https://thumbnails.roblox.com',
    economy: 'https://economy.roblox.com',
    avatar: 'https://avatar.roblox.com',
    inventory: 'https://inventory.roblox.com',
    groups: 'https://groups.roblox.com',
    presence: 'https://presence.roblox.com',
    accountInformation: 'https://accountinformation.roblox.com',
    badges: 'https://badges.roblox.com',
    develop: 'https://develop.roblox.com',
    assetDelivery: 'https://assetdelivery.roblox.com',
    auth: 'https://auth.roblox.com',
    apis: 'https://apis.roblox.com',
    clientSettings: 'https://clientsettings.roblox.com',
    setup: 'https://setup.rbxcdn.com',
  },

  // 8ball responses
  eightBallResponses: [
    'It is certain.', 'It is decidedly so.', 'Without a doubt.',
    'Yes — definitely.', 'You may rely on it.', 'As I see it, yes.',
    'Most likely.', 'Outlook good.', 'Yes.', 'Signs point to yes.',
    'Reply hazy, try again.', 'Ask again later.', 'Better not tell you now.',
    'Cannot predict now.', 'Concentrate and ask again.',
    "Don't count on it.", 'My reply is no.', 'My sources say no.',
    'Outlook not so good.', 'Very doubtful.'
  ],

  // Roblox DevEx rates
  devexRates: {
    rate: 0.0038, // Standard rate for Earned Robux earned on/after September 5, 2025
    minCashout: 30000,
  },

  // Roblox tax rate
  robloxTaxRate: 0.30, // 30% marketplace fee

  // Crypto chains
  cryptoChains: {
    bitcoin: { name: 'Bitcoin', symbol: 'BTC', coingeckoId: 'bitcoin', color: 0xF7931A },
    ethereum: { name: 'Ethereum', symbol: 'ETH', coingeckoId: 'ethereum', color: 0x627EEA },
    solana: { name: 'Solana', symbol: 'SOL', coingeckoId: 'solana', color: 0x9945FF },
    litecoin: { name: 'Litecoin', symbol: 'LTC', coingeckoId: 'litecoin', color: 0xBFBBB6 },
  },

  // Pagination defaults
  pagination: {
    itemsPerPage: 10,
    timeout: 120000, // 2 minutes
  },
};
