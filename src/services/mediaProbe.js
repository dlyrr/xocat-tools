// ============================================================
// yt-dlp metadata probe
// ------------------------------------------------------------
// Extracted from the API server so both the public /scrape route and the
// authenticated /web/media route return exactly the same shape. Nothing here
// downloads the media itself — it only asks yt-dlp what is there.
// ============================================================
const { execFile } = require('child_process');
const { YT_DLP, USER_AGENT } = require('../utils/ytdlp');

const DEFAULT_TIMEOUT_MS = 30000;

// Cap the format selection so the direct link we hand back is something a
// browser can actually play rather than a 4K master.
const FORMAT_SELECTOR = 'bv*[height<=720]+ba/b[height<=720]/bv*+ba/b';

class MediaProbeError extends Error {
  constructor(message, { status = 500, detail } = {}) {
    super(message);
    this.name = 'MediaProbeError';
    this.status = status;
    this.detail = detail;
  }
}

function normalize(data) {
  return {
    url: data.webpage_url || data.url,
    direct_link: data.url,
    title: data.title || data.fulltitle,
    description: data.description,
    view_count: data.view_count,
    like_count: data.like_count,
    uploader: data.uploader || data.channel || data.creator,
    uploader_url: data.uploader_url || data.channel_url,
    thumbnail: data.thumbnail,
    duration: data.duration,
    width: data.width,
    height: data.height,
    fps: data.fps,
    filesize: data.filesize || data.filesize_approx,
    extractor: data.extractor_key || data.extractor,
    format: data.format,
  };
}

/**
 * Ask yt-dlp to describe whatever is at `url`.
 *
 * @param {string} url page to probe
 * @param {object} [options]
 * @param {number} [options.timeout] milliseconds before giving up
 * @returns {Promise<object>} normalized media descriptor
 * @throws {MediaProbeError}
 */
function probeMedia(url, { timeout = DEFAULT_TIMEOUT_MS } = {}) {
  const trimmed = String(url || '').trim();
  if (!/^https?:\/\//i.test(trimmed)) {
    throw new MediaProbeError('Pass an http(s) URL to probe.', { status: 400 });
  }

  const args = [
    '--dump-json',
    '--no-playlist',
    '--no-warnings',
    '--format', FORMAT_SELECTOR,
    '--user-agent', USER_AGENT,
    trimmed,
  ];

  return new Promise((resolve, reject) => {
    execFile(YT_DLP, args, { timeout, maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        return reject(new MediaProbeError('Failed to extract media.', {
          status: 502,
          detail: String(stderr || error.message).slice(0, 300),
        }));
      }

      try {
        resolve(normalize(JSON.parse(stdout)));
      } catch (parseError) {
        reject(new MediaProbeError('Failed to parse media data.', {
          status: 502,
          detail: parseError.message,
        }));
      }
    });
  });
}

module.exports = { MediaProbeError, probeMedia };
