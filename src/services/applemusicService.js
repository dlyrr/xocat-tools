// ============================================================
// Apple Music Service (via iTunes Search API)
// ============================================================
const axios = require('axios');

async function searchTrack(query, limit = 5) {
  const { data } = await axios.get('https://itunes.apple.com/search', {
    params: {
      term: query,
      media: 'music',
      entity: 'song',
      limit,
    },
    timeout: 10000,
  });
  return data;
}

async function searchArtist(query, limit = 5) {
  const { data } = await axios.get('https://itunes.apple.com/search', {
    params: {
      term: query,
      media: 'music',
      entity: 'musicArtist',
      limit,
    },
    timeout: 10000,
  });
  return data;
}

module.exports = {
  searchTrack,
  searchArtist,
};
