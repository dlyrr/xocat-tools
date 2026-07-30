const axios = require('axios');
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

const FFMPEG = require('ffmpeg-static');
const { YT_DLP, USER_AGENT, ytDlpExists } = require('../utils/ytdlp');
const SUPPORTED_MEDIA_DOMAINS = [
  'instagram.com', 'tiktok.com', 'youtube.com', 'youtu.be',
  'twitter.com', 'x.com', 'reddit.com', 'redd.it',
  'pinterest.com', 'pin.it', 'facebook.com', 'fb.watch', 'threads.net',
  'soundcloud.com', 'snd.sc',
];

function runProcess(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const timeout = options.timeout ?? 120000;
    execFile(command, args, { maxBuffer: 4 * 1024 * 1024, ...options, timeout }, (error, stdout, stderr) => {
      if (error) {
        if (error.killed || error.signal) {
          return reject(new Error(`Media processing timed out after ${Math.ceil(timeout / 1000)} seconds.`));
        }

        // FFmpeg can emit thousands of progress lines. Keep command errors useful
        // without flooding the bot console or Discord response.
        const rawDetail = String(stderr || stdout || error.message).trim();
        const detail = rawDetail.length > 2000 ? rawDetail.slice(-2000) : rawDetail;
        return reject(new Error(detail || error.message));
      }
      resolve(String(stdout || ''));
    });
  });
}

function formatSize(format) {
  const size = Number(format.filesize || format.filesize_approx || 0);
  return Number.isFinite(size) && size > 0 ? size : 0;
}

function chooseSizeLimitedFormat(info, maxBytes) {
  const formats = Array.isArray(info?.formats) ? info.formats : [];
  const usable = formats.filter(format => format.format_id && formatSize(format) > 0);

  const combined = usable
    .filter(format => format.vcodec !== 'none' && format.acodec !== 'none' && formatSize(format) <= maxBytes)
    .sort((a, b) => {
      const mp4Difference = Number(b.ext === 'mp4') - Number(a.ext === 'mp4');
      if (mp4Difference) return mp4Difference;
      return (Number(b.height) || 0) - (Number(a.height) || 0)
        || formatSize(b) - formatSize(a);
    });
  if (combined[0]) return combined[0].format_id;

  const videoFormats = usable.filter(format => format.vcodec !== 'none' && format.acodec === 'none');
  const audioFormats = usable.filter(format => format.vcodec === 'none' && format.acodec !== 'none');

  if (!videoFormats.length && audioFormats.length) {
    // Audio-only source (e.g. SoundCloud) — there's no video track to pair,
    // so just pick the highest-quality audio format that fits the budget.
    const bestAudio = audioFormats
      .filter(format => formatSize(format) <= maxBytes)
      .sort((a, b) => formatSize(b) - formatSize(a))[0];
    if (bestAudio) return bestAudio.format_id;
  }

  const pairs = [];
  for (const video of videoFormats) {
    for (const audio of audioFormats) {
      const size = formatSize(video) + formatSize(audio);
      if (size > maxBytes) continue;
      const mp4Compatible = video.ext === 'mp4' && ['m4a', 'mp4'].includes(audio.ext);
      pairs.push({
        selector: `${video.format_id}+${audio.format_id}`,
        height: Number(video.height) || 0,
        size,
        mp4Compatible,
      });
    }
  }

  pairs.sort((a, b) => Number(b.mp4Compatible) - Number(a.mp4Compatible)
    || b.height - a.height
    || b.size - a.size);
  return pairs[0]?.selector || null;
}

async function findSizeLimitedFormat(url, maxBytes, commonArgs) {
  try {
    const rawInfo = await runProcess(YT_DLP, [
      '--dump-single-json',
      '--skip-download',
      ...commonArgs,
      '--', url,
    ], { timeout: 45000 });
    const info = JSON.parse(rawInfo);
    return { selector: chooseSizeLimitedFormat(info, maxBytes), info };
  } catch (error) {
    console.warn(`[media] could not preselect an upload-sized format: ${error.message}`);
    return { selector: null, info: null };
  }
}

function normalizeMediaMetadata(info) {
  if (!info || typeof info !== 'object') return null;
  const numeric = (value) => {
    if (value === null || value === undefined || value === '') return null;
    return Number.isFinite(Number(value)) ? Number(value) : null;
  };
  return {
    title: typeof info.title === 'string' ? info.title : null,
    description: typeof info.description === 'string' ? info.description : null,
    uploader: typeof info.uploader === 'string' ? info.uploader : null,
    uploaderId: typeof info.uploader_id === 'string' ? info.uploader_id : null,
    timestamp: numeric(info.timestamp),
    duration: numeric(info.duration),
    views: numeric(info.view_count),
    likes: numeric(info.like_count),
    comments: numeric(info.comment_count),
    shares: numeric(info.repost_count ?? info.share_count),
    saves: numeric(info.save_count),
  };
}

function validateMediaUrl(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('Please provide a valid http or https URL.');
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('Only http and https URLs are supported.');
  }
  if (parsed.username || parsed.password) throw new Error('URLs containing credentials are not supported.');

  const hostname = parsed.hostname.toLowerCase();
  const supported = SUPPORTED_MEDIA_DOMAINS.some(domain => hostname === domain || hostname.endsWith(`.${domain}`));
  if (!supported) {
    throw new Error(`Unsupported website. Supported platforms: Instagram, TikTok, YouTube, X/Twitter, Reddit, Pinterest, Facebook, Threads, and SoundCloud.`);
  }

  return parsed.toString();
}

function getCookieArgs() {
  if (process.env.YTDLP_COOKIES_FILE) {
    const cookiePath = path.resolve(process.cwd(), process.env.YTDLP_COOKIES_FILE);
    if (!fs.existsSync(cookiePath)) {
      throw new Error(`YTDLP_COOKIES_FILE does not exist: ${cookiePath}`);
    }
    return ['--cookies', cookiePath];
  }

  if (process.env.YTDLP_COOKIES_BROWSER) {
    return ['--cookies-from-browser', process.env.YTDLP_COOKIES_BROWSER];
  }

  return [];
}

function configuredCobaltInstances() {
  const value = process.env.COBALT_API_URLS || process.env.COBALT_API_URL || '';
  return value.split(',').map(item => item.trim()).filter(Boolean);
}

function discoverOutputs(outPath) {
  const directory = path.dirname(outPath);
  const stem = path.basename(outPath, path.extname(outPath));
  const candidates = fs.readdirSync(directory)
    .filter(file => file.startsWith(stem) && !file.endsWith('.part') && !file.endsWith('.ytdl'))
    .map(file => path.join(directory, file))
    .filter(file => fs.statSync(file).isFile())
    .sort((a, b) => a.localeCompare(b));

  if (!candidates.length) throw new Error('The downloader did not produce an output file.');
  return candidates;
}

function removePartialOutputs(outPath) {
  const directory = path.dirname(outPath);
  const stem = path.basename(outPath, path.extname(outPath));
  for (const file of fs.readdirSync(directory)) {
    if (!file.startsWith(stem)) continue;
    try { fs.unlinkSync(path.join(directory, file)); } catch { }
  }
}

async function downloadWithYtDlp(url, outPath, options = {}) {
  if (!ytDlpExists()) throw new Error(`yt-dlp is missing at ${YT_DLP}`);

  // Instagram carousels resolve to multiple slides (a yt-dlp "playlist"). Every
  // slide needs its own indexed filename or later slides overwrite earlier ones.
  const stem = outPath.slice(0, -path.extname(outPath).length);
  const outputTemplate = `${stem}_%(playlist_index|1)03d.%(ext)s`;
  const isInstagram = /instagram\.com/i.test(url);
  const commonArgs = [
    '--ffmpeg-location', FFMPEG,
    ...(isInstagram ? ['--yes-playlist', '--playlist-items', '1-10'] : ['--no-playlist']),
    '--no-warnings',
    '--no-progress',
    '--user-agent', USER_AGENT,
    ...getCookieArgs(),
  ];
  const attempts = [];
  let mediaInfo = null;
  if (options.maxBytes) {
    // Leave room for container differences when yt-dlp only has an estimated size.
    const selectionLimit = Math.floor(options.maxBytes * 0.96);
    const preflight = await findSizeLimitedFormat(url, selectionLimit, commonArgs);
    const selector = preflight.selector;
    mediaInfo = preflight.info;
    if (selector) {
      attempts.push([
        '--format', selector,
        '--max-filesize', String(options.maxBytes),
        '--merge-output-format', 'mp4',
      ]);
    }
  }
  attempts.push(
    ['--format', 'bv*[height<=720]+ba/b[height<=720]/b', '--merge-output-format', 'mp4'],
    [],
  );
  let lastError;

  for (const formatArgs of attempts) {
    try {
      await runProcess(YT_DLP, ['-o', outputTemplate, ...formatArgs, ...commonArgs, '--', url]);
      const filePaths = discoverOutputs(outPath).filter(file => fs.statSync(file).size >= 1024);
      if (!filePaths.length) throw new Error('Downloaded file is unexpectedly small.');
      return { filePaths, metadata: normalizeMediaMetadata(mediaInfo) };
    } catch (error) {
      lastError = error;
      removePartialOutputs(outPath);
    }
  }

  throw lastError || new Error('yt-dlp failed to download the media.');
}

function cobaltHeaders() {
  const headers = { Accept: 'application/json', 'Content-Type': 'application/json' };
  if (process.env.COBALT_API_TOKEN) {
    headers.Authorization = `${process.env.COBALT_API_AUTH_SCHEME || 'Api-Key'} ${process.env.COBALT_API_TOKEN}`;
  }
  return headers;
}

function extensionFromUrl(mediaUrl) {
  try {
    const extension = path.extname(new URL(mediaUrl).pathname).toLowerCase();
    return /^\.[a-z0-9]{2,5}$/.test(extension) ? extension : null;
  } catch {
    return null;
  }
}

function extensionFromCobalt(data, itemUrl) {
  const fromFilename = path.extname(data.filename || '').toLowerCase();
  if (/^\.[a-z0-9]{2,5}$/.test(fromFilename)) return fromFilename;
  return extensionFromUrl(itemUrl) || '.mp4';
}

async function downloadWithCobalt(url, outPath) {
  const instances = configuredCobaltInstances();
  if (!instances.length) throw new Error('No Cobalt API is configured.');

  const stem = outPath.slice(0, -path.extname(outPath).length);
  let lastError;
  for (const rawInstance of instances) {
    const instance = rawInstance.replace(/\/+$/, '');
    try {
      const response = await axios.post(`${instance}/`, {
        url,
        videoQuality: '720',
        audioFormat: 'mp3',
        filenameStyle: 'basic',
      }, { headers: cobaltHeaders(), timeout: 20000 });

      const data = response.data || {};
      if (data.status === 'error') throw new Error(data.error?.code || 'Cobalt returned an error.');

      let directUrls;
      if (data.status === 'tunnel' || data.status === 'redirect') directUrls = [data.url];
      // "picker" is Cobalt's response for multi-item posts (e.g. Instagram carousels
      // or multi-photo tweets) — grab every item, not just the first.
      else if (data.status === 'picker') directUrls = (data.picker || []).map(item => item.url).filter(Boolean);
      if (!directUrls?.length) throw new Error(`Unsupported Cobalt response: ${data.status || 'unknown'}`);

      const filePaths = [];
      for (let index = 0; index < directUrls.length; index += 1) {
        const extension = extensionFromCobalt(data, directUrls[index]);
        const destination = `${stem}_${String(index + 1).padStart(3, '0')}${extension}`;
        const mediaResponse = await axios.get(directUrls[index], {
          responseType: 'stream',
          timeout: 120000,
          maxRedirects: 5,
          headers: { 'User-Agent': USER_AGENT },
        });

        await new Promise((resolve, reject) => {
          const writer = fs.createWriteStream(destination);
          mediaResponse.data.pipe(writer);
          writer.on('close', resolve);
          writer.on('error', reject);
          mediaResponse.data.on('error', reject);
        });

        if (fs.statSync(destination).size < 1024) throw new Error('Cobalt returned an unexpectedly small file.');
        filePaths.push(destination);
      }

      console.log(`[media] downloaded via Cobalt: ${instance}`);
      return filePaths;
    } catch (error) {
      lastError = error;
      removePartialOutputs(outPath);
      console.warn(`[media] Cobalt failed (${instance}): ${error.message}`);
    }
  }

  throw lastError || new Error('Every configured Cobalt instance failed.');
}

function extractTweetId(url) {
  const match = url.match(/status(?:es)?\/(\d+)/);
  if (!match) throw new Error('Could not find a tweet ID in this URL.');
  return match[1];
}

function syndicationToken(id) {
  return ((Number(id) / 1e15) * Math.PI).toString(36).replace(/(0+|\.)/g, '');
}

// yt-dlp's Twitter extractor only ever extracts video/GIF media — it errors with
// "No video could be found in this tweet" for photo-only tweets by design. Twitter's
// public syndication endpoint (used by Twitter's own embed widget, no auth required)
// exposes photo URLs directly, so we use it as a dedicated fallback for that case.
async function downloadTwitterPhotos(url, outPath) {
  const id = extractTweetId(url);
  const token = syndicationToken(id);
  const response = await axios.get('https://cdn.syndication.twimg.com/tweet-result', {
    params: { id, token, lang: 'en' },
    headers: { 'User-Agent': USER_AGENT },
    timeout: 20000,
  });

  const tweet = response.data;
  if (!tweet || tweet.__typename === 'TweetTombstone') {
    throw new Error('This tweet is unavailable (deleted, private, or age-restricted).');
  }

  const photos = Array.isArray(tweet.photos) ? tweet.photos.filter(photo => photo?.url) : [];
  if (!photos.length) {
    throw new Error(tweet.video ? 'This tweet has a video, not photos.' : 'No photos could be found in this tweet.');
  }

  const stem = outPath.slice(0, -path.extname(outPath).length);
  const filePaths = [];
  for (let index = 0; index < photos.length; index += 1) {
    const destination = `${stem}_${String(index + 1).padStart(3, '0')}${extensionFromUrl(photos[index].url) || '.jpg'}`;
    const mediaResponse = await axios.get(photos[index].url, {
      responseType: 'stream',
      timeout: 30000,
      headers: { 'User-Agent': USER_AGENT },
    });

    await new Promise((resolve, reject) => {
      const writer = fs.createWriteStream(destination);
      mediaResponse.data.pipe(writer);
      writer.on('close', resolve);
      writer.on('error', reject);
      mediaResponse.data.on('error', reject);
    });

    if (fs.statSync(destination).size < 512) throw new Error('Twitter returned an unexpectedly small image.');
    filePaths.push(destination);
  }

  const metadata = {
    title: null,
    description: typeof tweet.text === 'string' ? tweet.text : null,
    uploader: tweet.user?.name || null,
    uploaderId: tweet.user?.screen_name || null,
    timestamp: tweet.created_at ? Math.floor(Date.parse(tweet.created_at) / 1000) : null,
    duration: null,
    views: null,
    likes: Number.isFinite(tweet.favorite_count) ? tweet.favorite_count : null,
    comments: Number.isFinite(tweet.conversation_count) ? tweet.conversation_count : null,
    shares: null,
    saves: null,
  };

  return { filePaths, metadata };
}

async function downloadMedia(value, outPath, options = {}) {
  const url = validateMediaUrl(value);
  let ytDlpError;

  try {
    const result = await downloadWithYtDlp(url, outPath, options);
    console.log('[media] downloaded via yt-dlp');
    return result;
  } catch (error) {
    ytDlpError = error;
    console.warn(`[media] yt-dlp failed: ${error.message}`);
  }

  if (/twitter\.com|x\.com/i.test(url) && /no video could be found/i.test(ytDlpError.message)) {
    try {
      const result = await downloadTwitterPhotos(url, outPath);
      console.log('[media] downloaded via Twitter syndication API');
      return result;
    } catch (photoError) {
      console.warn(`[media] Twitter photo fallback failed: ${photoError.message}`);
      ytDlpError = new Error(`${ytDlpError.message}\n${photoError.message}`);
    }
  }

  if (configuredCobaltInstances().length) {
    try {
      const filePaths = await downloadWithCobalt(url, outPath);
      return { filePaths, metadata: null };
    } catch (cobaltError) {
      throw new Error(`yt-dlp: ${ytDlpError.message}\nCobalt: ${cobaltError.message}`);
    }
  }

  const cookieHint = /instagram\.com/i.test(url) && !process.env.YTDLP_COOKIES_FILE && !process.env.YTDLP_COOKIES_BROWSER
    ? ' If Instagram requires a login, configure YTDLP_COOKIES_FILE or YTDLP_COOKIES_BROWSER.'
    : '';
  throw new Error(`${ytDlpError.message}${cookieHint}`);
}

module.exports = {
  FFMPEG,
  downloadMedia,
  downloadWithCobalt,
  downloadWithYtDlp,
  downloadTwitterPhotos,
  chooseSizeLimitedFormat,
  normalizeMediaMetadata,
  runProcess,
  SUPPORTED_MEDIA_DOMAINS,
  validateMediaUrl,
};
