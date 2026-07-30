// ============================================================
// Roblox API Service
// ============================================================
const axios = require('axios');
const { robloxAPIs } = require('../utils/constants');

const robloxAxios = axios.create({ timeout: 10000 });

// ---- User endpoints ----

async function getUserByUsername(username) {
  const { data } = await robloxAxios.post(`${robloxAPIs.users}/v1/usernames/users`, {
    usernames: [username],
    excludeBannedUsers: false,
  });
  return data.data?.[0] || null;
}

async function getUserById(userId) {
  const { data } = await robloxAxios.get(`${robloxAPIs.users}/v1/users/${userId}`);
  return data;
}

async function getUsersByIds(userIds) {
  const { data } = await robloxAxios.post(`${robloxAPIs.users}/v1/users`, {
    userIds,
    excludeBannedUsers: false,
  });
  return data.data || [];
}

async function multiUsernameToId(usernames) {
  const { data } = await robloxAxios.post(`${robloxAPIs.users}/v1/usernames/users`, {
    usernames,
    excludeBannedUsers: false,
  });
  return data.data || [];
}

// ---- Friends ----

async function getUserFriends(userId) {
  const { data } = await robloxAxios.get(`${robloxAPIs.friends}/v1/users/${userId}/friends`);
  return data.data || [];
}

async function getFriendsCount(userId) {
  const { data } = await robloxAxios.get(`${robloxAPIs.friends}/v1/users/${userId}/friends/count`);
  return data.count;
}

// ---- Thumbnails ----

async function getUserThumbnail(userId, size = '420x420', format = 'Png', isCircular = false) {
  const { data } = await robloxAxios.get(`${robloxAPIs.thumbnails}/v1/users/avatar-headshot`, {
    params: { userIds: userId, size, format, isCircular },
  });
  return data.data?.[0]?.imageUrl || null;
}

async function getUserFullBody(userId, size = '420x420') {
  const { data } = await robloxAxios.get(`${robloxAPIs.thumbnails}/v1/users/avatar`, {
    params: { userIds: userId, size, format: 'Png', isCircular: false },
  });
  return data.data?.[0]?.imageUrl || null;
}

async function getAssetThumbnail(assetId, size = '420x420') {
  const { data } = await robloxAxios.get(`${robloxAPIs.thumbnails}/v1/assets`, {
    params: { assetIds: assetId, size, format: 'Png' },
  });
  return data.data?.[0]?.imageUrl || null;
}

// ---- Avatar / Outfits ----

async function getUserOutfits(userId) {
  const { data } = await robloxAxios.get(`${robloxAPIs.avatar}/v1/users/${userId}/outfits`, {
    params: { page: 1, itemsPerPage: 25 },
  });
  const outfits = data.data || [];
  return { outfits, total: Number.isFinite(Number(data.total)) ? Number(data.total) : outfits.length };
}

async function getUserAvatar(userId) {
  const { data } = await robloxAxios.get(`${robloxAPIs.avatar}/v1/users/${userId}/avatar`);
  return data;
}

// ---- Inventory / RAP ----

async function getUserCollectibles(userId) {
  const items = [];
  let cursor = '';
  let page = 0;
  do {
    const { data } = await robloxAxios.get(
      `${robloxAPIs.inventory}/v1/users/${userId}/assets/collectibles`,
      { params: { sortOrder: 'Desc', limit: 100, cursor } }
    );
    items.push(...(data.data || []));
    cursor = data.nextPageCursor || '';
    page++;
    if (page >= 50 && cursor) {
      throw new Error('This inventory is too large to calculate accurately in one command.');
    }
  } while (cursor);
  return items;
}

// ---- Games ----

async function getGameDetails(universeIds) {
  const { data } = await robloxAxios.get(`${robloxAPIs.games}/v1/games`, {
    params: { universeIds: Array.isArray(universeIds) ? universeIds.join(',') : universeIds },
  });
  return data.data || [];
}

async function getGameServers(placeId, serverType = 'Public', sortOrder = 'Asc', limit = 10) {
  const { data } = await robloxAxios.get(`${robloxAPIs.games}/v1/games/${placeId}/servers/${serverType}`, {
    params: { sortOrder, limit },
  });
  return data;
}

async function getUniverseFromPlace(placeId) {
  const { data } = await robloxAxios.get(`${robloxAPIs.apis}/universes/v1/places/${placeId}/universe`);
  return data;
}

async function getGameCharts(sortToken = 'TopRated', limit = 25) {
  const { data } = await robloxAxios.get(`${robloxAPIs.games}/v1/games/sorts`, {
    params: { 'model.gameSortsContext': 'HomeSorts' },
  });
  return data;
}

async function getGamesList(sortToken, limit = 25) {
  const { data } = await robloxAxios.get(`${robloxAPIs.games}/v1/games/list`, {
    params: { sortToken, limit, 'model.gameSortsContext': 'HomeSorts' },
  });
  return data;
}

// ---- Catalog ----

async function searchCatalog(params) {
  const { data } = await robloxAxios.get(`${robloxAPIs.catalog}/v1/search/items`, { params });
  return data;
}

async function getCatalogItemDetails(items) {
  const { data } = await robloxAxios.post(`${robloxAPIs.catalog}/v1/catalog/items/details`, { items });
  return data.data || [];
}

// ---- Client Versions ----

async function getClientVersions() {
  const platforms = [
    'WindowsPlayer', 'WindowsStudio64', 'MacPlayer', 'MacStudio',
    'AndroidApp', 'iOSApp', 'XboxClient', 'UWPApp',
  ];
  const results = {};
  for (const platform of platforms) {
    try {
      const { data } = await robloxAxios.get(`${robloxAPIs.clientSettings}/v2/client-version/${platform}`);
      results[platform] = data;
    } catch {
      results[platform] = null;
    }
  }
  return results;
}

// ---- Release Notes ----

async function getReleaseNotes() {
  try {
    const { data } = await robloxAxios.get('https://devforum.roblox.com/c/updates/release-notes.json');
    return data.topic_list?.topics?.slice(0, 5) || [];
  } catch {
    return [];
  }
}

// ---- Presence ----

async function getUserPresence(userIds) {
  const { data } = await robloxAxios.post(`${robloxAPIs.presence}/v1/presence/users`, { userIds });
  return data.userPresences || [];
}

// ---- Subplaces ----

async function getSubplaces(universeId) {
  const places = [];
  let cursor = '';
  let page = 0;
  do {
    const { data } = await robloxAxios.get(`${robloxAPIs.develop}/v1/universes/${universeId}/places`, {
      params: { sortOrder: 'Asc', limit: 100, cursor: cursor || undefined },
    });
    places.push(...(data.data || []));
    cursor = data.nextPageCursor || '';
    page += 1;
  } while (cursor && page < 20);
  return { places, truncated: Boolean(cursor) };
}

// ---- Asset Delivery ----

async function getAssetUrl(assetId) {
  const { data } = await robloxAxios.get(`${robloxAPIs.assetDelivery}/v1/asset`, {
    params: { id: assetId },
    maxRedirects: 0,
    validateStatus: s => s < 400,
  });
  return data;
}

// ---- Ownership Check ----

async function userOwnsAsset(userId, assetId) {
  const { data } = await robloxAxios.get(
    `${robloxAPIs.inventory}/v1/users/${userId}/items/Asset/${assetId}`
  );
  return Boolean(data.data?.length);
}

// ---- Chat color prediction ----

function predictChatColor(username) {
  // Exact port of Roblox's classic ExtraDataInitializer ComputeNameColor.
  const colors = [
    { name: 'Bright red', hex: '#FD2943', rgb: [253, 41, 67] },
    { name: 'Bright blue', hex: '#01A2FF', rgb: [1, 162, 255] },
    { name: 'Earth green', hex: '#02B857', rgb: [2, 184, 87] },
    { name: 'Bright violet', hex: '#6B327C', rgb: [107, 50, 124] },
    { name: 'Bright orange', hex: '#DA8541', rgb: [218, 133, 65] },
    { name: 'Bright yellow', hex: '#F5CD30', rgb: [245, 205, 48] },
    { name: 'Light reddish violet', hex: '#E8BAC8', rgb: [232, 186, 200] },
    { name: 'Brick yellow', hex: '#D7C59A', rgb: [215, 197, 154] },
  ];

  let value = 0;
  for (let i = 0; i < username.length; i++) {
    let characterValue = username.charCodeAt(i);
    let reverseIndex = username.length - i;
    if (username.length % 2 === 1) reverseIndex -= 1;
    if (reverseIndex % 4 >= 2) characterValue = -characterValue;
    value += characterValue;
  }

  const colorIndex = ((value % colors.length) + colors.length) % colors.length;
  return colors[colorIndex];
}

module.exports = {
  getUserByUsername, getUserById, getUsersByIds, multiUsernameToId,
  getUserFriends, getFriendsCount,
  getUserThumbnail, getUserFullBody, getAssetThumbnail,
  getUserOutfits, getUserAvatar,
  getUserCollectibles,
  getGameDetails, getGameServers, getUniverseFromPlace, getGameCharts, getGamesList,
  searchCatalog, getCatalogItemDetails,
  getClientVersions, getReleaseNotes,
  getUserPresence, getSubplaces, getAssetUrl,
  userOwnsAsset, predictChatColor,
};
