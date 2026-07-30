// ============================================================
// Last.fm Service
// Public, read-only Last.fm Web API helpers.
// ============================================================
const axios = require('axios');

const API_URL = 'https://ws.audioscrobbler.com/2.0/';
const REQUEST_TIMEOUT_MS = 10000;
const PERIODS = Object.freeze(['overall', '7day', '1month', '3month', '6month', '12month']);
const PERIOD_SET = new Set(PERIODS);

const client = axios.create({
  baseURL: API_URL,
  timeout: REQUEST_TIMEOUT_MS,
  headers: {
    Accept: 'application/json',
    'User-Agent': 'Discord-MultiBot/1.0 (Last.fm integration)',
  },
});

class LastFmError extends Error {
  constructor(message, { code = null, status = null, retryable = false, cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'LastFmError';
    this.code = code;
    this.status = status;
    this.retryable = retryable;
  }
}

function getApiKey() {
  const key = String(process.env.LASTFM_API_KEY || '').trim();
  if (!key || /^your[_-]?lastfm[_-]?api[_-]?key/i.test(key)) {
    throw new LastFmError('LASTFM_API_KEY is not configured in .env', { code: 'NOT_CONFIGURED' });
  }
  return key;
}

function requiredText(value, label, maxLength = 512) {
  if (typeof value !== 'string' && typeof value !== 'number') {
    throw new LastFmError(`${label} is required`, { code: 'INVALID_INPUT' });
  }

  const text = String(value).trim();
  if (!text) {
    throw new LastFmError(`${label} is required`, { code: 'INVALID_INPUT' });
  }
  if (text.length > maxLength) {
    throw new LastFmError(`${label} must be ${maxLength} characters or fewer`, { code: 'INVALID_INPUT' });
  }
  return text;
}

function optionalText(value, label, maxLength = 512) {
  if (value === undefined || value === null || value === '') return undefined;
  return requiredText(value, label, maxLength);
}

function boundedInteger(value, { label, fallback, min = 1, max = Number.MAX_SAFE_INTEGER }) {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new LastFmError(`${label} must be a number`, { code: 'INVALID_INPUT' });
  }
  return Math.min(max, Math.max(min, Math.trunc(parsed)));
}

function normalizePeriod(period = 'overall') {
  const value = String(period || 'overall').trim().toLowerCase();
  if (!PERIOD_SET.has(value)) {
    throw new LastFmError(`Unsupported period. Use one of: ${PERIODS.join(', ')}`, {
      code: 'INVALID_PERIOD',
    });
  }
  return value;
}

function normalizeTimestamp(value, label) {
  if (value === undefined || value === null || value === '') return undefined;
  const timestamp = boundedInteger(value, { label, fallback: undefined, min: 0 });
  return timestamp;
}

function normalizeApiError(error) {
  if (error instanceof LastFmError) return error;

  const body = error?.response?.data;
  const apiCode = body?.error ?? null;
  const status = error?.response?.status ?? null;
  const isTimeout = error?.code === 'ECONNABORTED' || error?.code === 'ETIMEDOUT';
  const isNetworkError = Boolean(error?.isAxiosError && !error.response);

  if (apiCode !== null) {
    const retryable = [11, 16, 29].includes(Number(apiCode)) || status === 429 || status >= 500;
    return new LastFmError(body.message || 'Last.fm rejected the request', {
      code: Number(apiCode),
      status,
      retryable,
      cause: error,
    });
  }

  if (isTimeout) {
    return new LastFmError('Last.fm did not respond within 10 seconds', {
      code: 'TIMEOUT',
      status,
      retryable: true,
      cause: error,
    });
  }

  if (isNetworkError) {
    return new LastFmError('Could not connect to Last.fm', {
      code: 'NETWORK_ERROR',
      retryable: true,
      cause: error,
    });
  }

  return new LastFmError('Last.fm request failed', {
    code: 'REQUEST_FAILED',
    status,
    retryable: status === 429 || status >= 500,
    cause: error,
  });
}

/**
 * Execute a read-only Last.fm API method.
 * Undefined/null/empty-string params are omitted and the API key never appears in thrown errors.
 */
async function requestLastFm(method, params = {}) {
  const normalizedMethod = requiredText(method, 'Last.fm method', 100);
  if (!/^[a-z]+\.[a-z]+$/i.test(normalizedMethod)) {
    throw new LastFmError('Invalid Last.fm method name', { code: 'INVALID_INPUT' });
  }
  if (!params || typeof params !== 'object' || Array.isArray(params)) {
    throw new LastFmError('Last.fm request params must be an object', { code: 'INVALID_INPUT' });
  }

  const cleanParams = Object.fromEntries(
    Object.entries(params).filter(([, value]) => value !== undefined && value !== null && value !== '')
  );

  try {
    const { data } = await client.get('', {
      params: {
        ...cleanParams,
        method: normalizedMethod,
        api_key: getApiKey(),
        format: 'json',
      },
    });

    if (!data || typeof data !== 'object') {
      throw new LastFmError('Last.fm returned an invalid response', { code: 'INVALID_RESPONSE' });
    }
    if (data.error !== undefined) {
      throw new LastFmError(data.message || 'Last.fm rejected the request', {
        code: Number(data.error),
        retryable: [11, 16, 29].includes(Number(data.error)),
      });
    }
    return data;
  } catch (error) {
    throw normalizeApiError(error);
  }
}

function paginationFrom(container) {
  const attr = container?.['@attr'] || {};
  return {
    page: Number(attr.page || 1),
    perPage: Number(attr.perPage || attr.perpage || 0),
    totalPages: Number(attr.totalPages || attr.totalpages || 0),
    total: Number(attr.total || 0),
    user: attr.user,
  };
}

function listOptions(options, defaults = {}) {
  const input = options && typeof options === 'object' && !Array.isArray(options) ? options : {};
  return {
    limit: boundedInteger(input.limit, {
      label: 'limit',
      fallback: defaults.limit ?? 10,
      min: 1,
      max: defaults.maxLimit ?? 200,
    }),
    page: boundedInteger(input.page, { label: 'page', fallback: defaults.page ?? 1, min: 1 }),
  };
}

function topOptions(periodOrOptions = 'overall', limit = 10, page = 1) {
  const input = periodOrOptions && typeof periodOrOptions === 'object'
    ? periodOrOptions
    : { period: periodOrOptions, limit, page };
  return {
    ...listOptions(input, { limit: 10, maxLimit: 200 }),
    period: normalizePeriod(input.period),
  };
}

function infoOptions(usernameOrOptions) {
  if (usernameOrOptions && typeof usernameOrOptions === 'object') return usernameOrOptions;
  return { username: usernameOrOptions };
}

async function getRecentTracksPage(username, options = {}) {
  const input = options && typeof options === 'object' && !Array.isArray(options)
    ? options
    : { limit: options };
  const { limit, page } = listOptions(input, { limit: 1, maxLimit: 200 });
  const from = normalizeTimestamp(input.from, 'from');
  const to = normalizeTimestamp(input.to, 'to');
  if (from !== undefined && to !== undefined && from > to) {
    throw new LastFmError('from must be earlier than or equal to to', { code: 'INVALID_INPUT' });
  }

  const data = await requestLastFm('user.getrecenttracks', {
    user: requiredText(username, 'Last.fm username', 256),
    limit,
    page,
    extended: input.extended ? 1 : 0,
    from,
    to,
  });
  const container = data.recenttracks || {};
  return {
    tracks: Array.isArray(container.track) ? container.track : [],
    pagination: paginationFrom(container),
  };
}

// Backward compatible: getRecentTracks(username, 1) still returns only the track array.
async function getRecentTracks(username, limit = 1, options = {}) {
  const input = limit && typeof limit === 'object'
    ? limit
    : { ...(options || {}), limit };
  return (await getRecentTracksPage(username, input)).tracks;
}

async function getUserInfo(username) {
  const data = await requestLastFm('user.getinfo', {
    user: requiredText(username, 'Last.fm username', 256),
  });
  if (!data.user) throw new LastFmError('Last.fm returned no user information', { code: 'INVALID_RESPONSE' });
  return data.user;
}

async function getUserTopPage(kind, username, periodOrOptions = 'overall', limit = 10, page = 1) {
  const config = {
    artists: { method: 'user.gettopartists', container: 'topartists', item: 'artist' },
    albums: { method: 'user.gettopalbums', container: 'topalbums', item: 'album' },
    tracks: { method: 'user.gettoptracks', container: 'toptracks', item: 'track' },
  }[kind];
  if (!config) throw new LastFmError('Invalid top-list kind', { code: 'INVALID_INPUT' });

  const options = topOptions(periodOrOptions, limit, page);
  const data = await requestLastFm(config.method, {
    user: requiredText(username, 'Last.fm username', 256),
    period: options.period,
    limit: options.limit,
    page: options.page,
  });
  const container = data[config.container] || {};
  return {
    items: Array.isArray(container[config.item]) ? container[config.item] : [],
    pagination: paginationFrom(container),
    period: container?.['@attr']?.type || options.period,
  };
}

async function getTopArtistsPage(username, periodOrOptions = 'overall', limit = 10, page = 1) {
  return getUserTopPage('artists', username, periodOrOptions, limit, page);
}

async function getTopAlbumsPage(username, periodOrOptions = 'overall', limit = 10, page = 1) {
  return getUserTopPage('albums', username, periodOrOptions, limit, page);
}

async function getTopTracksPage(username, periodOrOptions = 'overall', limit = 10, page = 1) {
  return getUserTopPage('tracks', username, periodOrOptions, limit, page);
}

async function getTopArtists(username, periodOrOptions = 'overall', limit = 10, page = 1) {
  return (await getTopArtistsPage(username, periodOrOptions, limit, page)).items;
}

async function getTopAlbums(username, periodOrOptions = 'overall', limit = 10, page = 1) {
  return (await getTopAlbumsPage(username, periodOrOptions, limit, page)).items;
}

async function getTopTracks(username, periodOrOptions = 'overall', limit = 10, page = 1) {
  return (await getTopTracksPage(username, periodOrOptions, limit, page)).items;
}

async function getLovedTracksPage(username, options = {}, pageArg = 1) {
  const input = options && typeof options === 'object' ? options : { limit: options, page: pageArg };
  const { limit, page } = listOptions(input, { limit: 10, maxLimit: 200 });
  const data = await requestLastFm('user.getlovedtracks', {
    user: requiredText(username, 'Last.fm username', 256),
    limit,
    page,
  });
  const container = data.lovedtracks || {};
  return {
    tracks: Array.isArray(container.track) ? container.track : [],
    pagination: paginationFrom(container),
  };
}

async function getLovedTracks(username, options = 10, page = 1) {
  return (await getLovedTracksPage(username, options, page)).tracks;
}

async function getArtistInfo(artist, usernameOrOptions) {
  const options = infoOptions(usernameOrOptions);
  const lang = optionalText(options.lang, 'language', 8);
  if (lang && !/^[a-z]{2}(?:-[a-z]{2})?$/i.test(lang)) {
    throw new LastFmError('language must be an ISO language code such as en', { code: 'INVALID_INPUT' });
  }
  const data = await requestLastFm('artist.getinfo', {
    artist: requiredText(artist, 'artist'),
    username: optionalText(options.username, 'Last.fm username', 256),
    lang,
    autocorrect: options.autocorrect === false ? 0 : 1,
  });
  if (!data.artist) throw new LastFmError('Last.fm returned no artist information', { code: 'INVALID_RESPONSE' });
  return data.artist;
}

async function getAlbumInfo(artist, album, usernameOrOptions) {
  const options = infoOptions(usernameOrOptions);
  const data = await requestLastFm('album.getinfo', {
    artist: requiredText(artist, 'artist'),
    album: requiredText(album, 'album'),
    username: optionalText(options.username, 'Last.fm username', 256),
    lang: optionalText(options.lang, 'language', 8),
    autocorrect: options.autocorrect === false ? 0 : 1,
  });
  if (!data.album) throw new LastFmError('Last.fm returned no album information', { code: 'INVALID_RESPONSE' });
  return data.album;
}

async function getTrackInfo(artist, track, usernameOrOptions) {
  const options = infoOptions(usernameOrOptions);
  const data = await requestLastFm('track.getinfo', {
    artist: requiredText(artist, 'artist'),
    track: requiredText(track, 'track'),
    username: optionalText(options.username, 'Last.fm username', 256),
    autocorrect: options.autocorrect === false ? 0 : 1,
  });
  if (!data.track) throw new LastFmError('Last.fm returned no track information', { code: 'INVALID_RESPONSE' });
  return data.track;
}

async function getArtistList(method, containerName, itemName, artist, options = {}, pageArg = 1) {
  const input = options && typeof options === 'object' ? options : { limit: options, page: pageArg };
  const { limit, page } = listOptions(input, { limit: 10, maxLimit: 200 });
  const data = await requestLastFm(method, {
    artist: requiredText(artist, 'artist'),
    limit,
    page,
    autocorrect: input.autocorrect === false ? 0 : 1,
  });
  const container = data[containerName] || {};
  return {
    items: Array.isArray(container[itemName]) ? container[itemName] : [],
    pagination: paginationFrom(container),
  };
}

async function getArtistTopTracksPage(artist, options = {}, page = 1) {
  return getArtistList('artist.gettoptracks', 'toptracks', 'track', artist, options, page);
}

async function getArtistTopAlbumsPage(artist, options = {}, page = 1) {
  return getArtistList('artist.gettopalbums', 'topalbums', 'album', artist, options, page);
}

async function getArtistTopTracks(artist, options = 10, page = 1) {
  return (await getArtistTopTracksPage(artist, options, page)).items;
}

async function getArtistTopAlbums(artist, options = 10, page = 1) {
  return (await getArtistTopAlbumsPage(artist, options, page)).items;
}

async function search(kind, query, options = {}, pageArg = 1) {
  const config = {
    artist: { method: 'artist.search', key: 'artist', matches: 'artistmatches' },
    album: { method: 'album.search', key: 'album', matches: 'albummatches' },
    track: { method: 'track.search', key: 'track', matches: 'trackmatches' },
  }[kind];
  if (!config) throw new LastFmError('Invalid Last.fm search kind', { code: 'INVALID_INPUT' });
  const input = options && typeof options === 'object' ? options : { limit: options, page: pageArg };
  const { limit, page } = listOptions(input, { limit: 10, maxLimit: 200 });
  const data = await requestLastFm(config.method, {
    [config.key]: requiredText(query, `${kind} search query`),
    limit,
    page,
  });
  const results = data.results || {};
  const matches = results[config.matches]?.[kind];
  return {
    items: Array.isArray(matches) ? matches : [],
    pagination: {
      page: Number(results['opensearch:Query']?.startPage || page),
      perPage: Number(results['opensearch:itemsPerPage'] || limit),
      totalPages: Math.ceil(Number(results['opensearch:totalResults'] || 0) / limit),
      total: Number(results['opensearch:totalResults'] || 0),
    },
  };
}

async function searchArtist(query, options = 10, page = 1) {
  return search('artist', query, options, page);
}

async function searchAlbum(query, options = 10, page = 1) {
  return search('album', query, options, page);
}

async function searchTrack(query, options = 10, page = 1) {
  return search('track', query, options, page);
}

async function getGlobalChart(kind, options = {}, pageArg = 1) {
  const config = {
    artists: { method: 'chart.gettopartists', container: 'artists', item: 'artist' },
    tracks: { method: 'chart.gettoptracks', container: 'tracks', item: 'track' },
  }[kind];
  if (!config) throw new LastFmError('Invalid chart kind', { code: 'INVALID_INPUT' });
  const input = options && typeof options === 'object' ? options : { limit: options, page: pageArg };
  const { limit, page } = listOptions(input, { limit: 10, maxLimit: 200 });
  const data = await requestLastFm(config.method, { limit, page });
  const container = data[config.container] || {};
  return {
    items: Array.isArray(container[config.item]) ? container[config.item] : [],
    pagination: paginationFrom(container),
  };
}

async function getGlobalTopArtists(options = 10, page = 1) {
  return getGlobalChart('artists', options, page);
}

async function getGlobalTopTracks(options = 10, page = 1) {
  return getGlobalChart('tracks', options, page);
}

module.exports = {
  API_URL,
  REQUEST_TIMEOUT_MS,
  PERIODS,
  LastFmError,
  requestLastFm,
  getRecentTracks,
  getRecentTracksPage,
  getUserInfo,
  getTopArtists,
  getTopArtistsPage,
  getTopAlbums,
  getTopAlbumsPage,
  getTopTracks,
  getTopTracksPage,
  getLovedTracks,
  getLovedTracksPage,
  getArtistInfo,
  getAlbumInfo,
  getTrackInfo,
  getArtistTopTracks,
  getArtistTopTracksPage,
  getArtistTopAlbums,
  getArtistTopAlbumsPage,
  searchArtist,
  searchAlbum,
  searchTrack,
  getGlobalTopArtists,
  getGlobalTopTracks,
};
