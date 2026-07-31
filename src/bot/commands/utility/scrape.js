const {
  SlashCommandBuilder,
  AttachmentBuilder,
  EmbedBuilder,
} = require('discord.js');
const { randomUUID } = require('crypto');
const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { FFMPEG, downloadMedia, runProcess } = require('../../../services/mediaDownloadService');
const { colors } = require('../../../utils/constants');

const DISCORD_LIMIT = 25 * 1024 * 1024;
const TARGET_UPLOAD_SIZE = 23.5 * 1024 * 1024;
const VIDEO_EXTENSIONS = new Set(['.mp4', '.webm', '.mov', '.mkv', '.avi']);

function detectPlatform(url) {
  if (/tiktok\.com/i.test(url)) return { name: 'TikTok' };
  if (/instagram\.com/i.test(url)) return { name: 'Instagram' };
  if (/twitter\.com/i.test(url)) return { name: 'Twitter' };
  if (/x\.com/i.test(url)) return { name: 'X' };
  if (/reddit\.com/i.test(url)) return { name: 'Reddit' };
  if (/youtube\.com|youtu\.be/i.test(url)) return { name: 'YouTube' };
  if (/pinterest\.com/i.test(url)) return { name: 'Pinterest' };
  if (/facebook\.com|fb\.watch/i.test(url)) return { name: 'Facebook' };
  if (/threads\.net/i.test(url)) return { name: 'Threads' };
  if (/soundcloud\.com|snd\.sc/i.test(url)) return { name: 'SoundCloud' };
  return { name: 'Web' };
}

function engagementSummary(metadata) {
  if (!metadata) return '';
  const formatter = new Intl.NumberFormat('en-US');
  return [
    ['Likes', metadata.likes],
    ['Comments', metadata.comments],
    ['Shares', metadata.shares],
    ['Views', metadata.views],
    ['Saves', metadata.saves],
  ]
    .filter(([, value]) => Number.isFinite(value) && value >= 0)
    .map(([label, value]) => `**${label}:** ${formatter.format(value)}`)
    .join(' · ');
}

function createScrapeEmbed(platform, metadata, originalUrl, attachmentCount = 1) {
  const stats = engagementSummary(metadata);
  const rawCaption = metadata?.description?.trim() || metadata?.title?.trim() || '';
  const captionBudget = Math.max(0, 4096 - stats.length - (stats && rawCaption ? 2 : 0));
  const caption = rawCaption.length > captionBudget
    ? `${rawCaption.slice(0, Math.max(0, captionBudget - 3))}...`
    : rawCaption;
  const description = [stats, caption].filter(Boolean).join('\n\n')
    || `[Open the original post](${originalUrl})`;
  const footerText = attachmentCount > 1 ? `${platform.name} · ${attachmentCount} photos` : platform.name;

  return new EmbedBuilder()
    .setColor(platform.name === 'Web' ? colors.utility : colors.social)
    .setDescription(description)
    .setFooter({ text: footerText });
}

function getDuration(filePath) {
  return new Promise((resolve) => {
    execFile(FFMPEG, ['-i', filePath, '-hide_banner'], { timeout: 10000 }, (_error, _stdout, stderr) => {
      const match = (stderr || '').match(/Duration:\s*(\d+):(\d+):(\d+)/);
      if (!match) return resolve(30);
      const seconds = Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
      resolve(Math.max(seconds, 1));
    });
  });
}

function compressionPlan(duration, height, targetBytes = TARGET_UPLOAD_SIZE) {
  // Reserve 14% for the MP4 container and bitrate variation. Long videos need
  // lower audio/video rates; a fixed 128k audio track alone can exceed the
  // entire upload budget.
  const totalBitrate = Math.floor((targetBytes * 8 * 0.86) / duration / 1000);
  const audioBitrate = totalBitrate >= 320 ? 96
    : totalBitrate >= 190 ? 64
      : totalBitrate >= 115 ? 40
        : 24;
  const videoBitrate = totalBitrate - audioBitrate - 6;
  if (videoBitrate < 40) {
    throw new Error('This video is too long to fit Discord without becoming unwatchable.');
  }

  const profile = videoBitrate >= 700 ? { height: 720, fps: 30 }
    : videoBitrate >= 380 ? { height: 480, fps: 24 }
      : videoBitrate >= 210 ? { height: 360, fps: 20 }
        : videoBitrate >= 105 ? { height: 240, fps: 15 }
          : { height: 180, fps: 12 };

  return {
    audioBitrate,
    videoBitrate,
    height: Math.max(2, Math.min(height || profile.height, profile.height)),
    fps: profile.fps,
  };
}

async function compress(inputPath, outputPath, targetBytes = TARGET_UPLOAD_SIZE) {
  const media = await inspectMedia(inputPath);
  const duration = media.duration || await getDuration(inputPath);
  const plan = compressionPlan(duration, media.height, targetBytes);
  const timeout = Math.min(8 * 60 * 1000, Math.max(150000, Math.ceil(duration * 220)));

  await runProcess(FFMPEG, [
    '-hide_banner',
    '-loglevel', 'error',
    '-nostats',
    '-i', inputPath,
    '-map', '0:v:0',
    '-map', '0:a:0?',
    '-sn',
    '-dn',
    '-c:v', 'libx264',
    '-b:v', `${plan.videoBitrate}k`,
    '-maxrate', `${Math.ceil(plan.videoBitrate * 1.15)}k`,
    '-bufsize', `${plan.videoBitrate * 2}k`,
    '-preset', 'veryfast',
    '-vf', `scale=-2:${plan.height},fps=${plan.fps}`,
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac',
    '-b:a', `${plan.audioBitrate}k`,
    '-movflags', '+faststart',
    '-y',
    outputPath,
  ], { timeout });
}

function inspectMedia(filePath) {
  return new Promise((resolve) => {
    execFile(FFMPEG, ['-i', filePath, '-hide_banner'], { timeout: 10000 }, (_error, _stdout, stderr = '') => {
      let duration = 0;
      let width = 0;
      let height = 0;
      let fps = 0;
      const durationMatch = stderr.match(/Duration:\s*(\d+):(\d+):(\d+)/);
      if (durationMatch) {
        duration = Number(durationMatch[1]) * 3600 + Number(durationMatch[2]) * 60 + Number(durationMatch[3]);
      }
      const resolutionMatch = stderr.match(/(\d{2,4})x(\d{2,4})/);
      if (resolutionMatch) [width, height] = [Number(resolutionMatch[1]), Number(resolutionMatch[2])];
      const fpsMatch = stderr.match(/([\d.]+)\s*fps/);
      if (fpsMatch) fps = Math.round(Number(fpsMatch[1]));
      resolve({ duration, width, height, fps });
    });
  });
}

const MAX_ATTACHMENTS = 10;

async function sendDownloadedMedia(interaction, url) {
  const platform = detectPlatform(url);
  const id = randomUUID();
  const dlPathBase = path.join(os.tmpdir(), `scrape_${id}.mp4`);
  let downloadedPaths = [];
  const compressedPaths = [];
  let metadata = null;

  try {
    // Prefer an existing source format that already fits Discord. This avoids
    // a slow full-video transcode for long YouTube and social-media posts.
    const download = await downloadMedia(url, dlPathBase, {
      maxBytes: TARGET_UPLOAD_SIZE,
    });
    downloadedPaths = download.filePaths || [];
    metadata = download.metadata;
    if (!downloadedPaths.length) throw new Error('The download completed without an output file.');

    if (downloadedPaths.length > MAX_ATTACHMENTS) {
      console.warn(`[scrape] ${downloadedPaths.length} files found, keeping the first ${MAX_ATTACHMENTS} for Discord's attachment limit`);
    }
    const selected = downloadedPaths.slice(0, MAX_ATTACHMENTS);

    const attachments = [];
    for (const [index, downloadedPath] of selected.entries()) {
      let finalPath = downloadedPath;
      const originalSize = fs.statSync(downloadedPath).size;
      const isVideo = VIDEO_EXTENSIONS.has(path.extname(downloadedPath).toLowerCase());

      if (originalSize > DISCORD_LIMIT && isVideo) {
        const compressedPath = path.join(os.tmpdir(), `scrape_${id}_compressed_${index}.mp4`);
        compressedPaths.push(compressedPath);
        try {
          await compress(downloadedPath, compressedPath);
          if (fs.existsSync(compressedPath) && fs.statSync(compressedPath).size < DISCORD_LIMIT) {
            finalPath = compressedPath;
          } else {
            continue;
          }
        } catch (error) {
          console.error(`[scrape] compression error: ${String(error.message || error).slice(0, 500)}`);
          continue;
        }
      } else if (originalSize > DISCORD_LIMIT) {
        continue;
      }

      const extension = path.extname(finalPath) || '.mp4';
      const fileName = `${platform.name.toLowerCase()}_${id}_${index}${extension}`;
      attachments.push(new AttachmentBuilder(finalPath, { name: fileName }));
    }

    if (!attachments.length) {
      return await interaction.editReply({ content: '❌ media is too big to send through Discord, even after compression.' });
    }

    const embed = createScrapeEmbed(platform, metadata, url, attachments.length);

    await interaction.editReply({
      embeds: [embed],
      files: attachments,
      components: [],
    });
  } catch (error) {
    console.error('[scrape] error:', error.message);
    const message = String(error.message || error).replace(/```/g, '').slice(0, 500);
    await interaction.editReply({ content: `❌ failed to download media.\n\`\`\`${message}\`\`\`` });
  } finally {
    cleanup(...downloadedPaths, ...compressedPaths, dlPathBase);
  }
}

function cleanup(...paths) {
  for (const filePath of new Set(paths)) {
    try {
      if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch { }
  }
}

module.exports = {
  prefixAliases: ['fetchpage', 'readpage'],
  data: new SlashCommandBuilder()
    .setName('scrape')
    .setDescription('Download media from a supported social-media URL')
    .addStringOption(option => option.setName('url').setDescription('URL to download from').setRequired(true).setMaxLength(2000))
    .addBooleanOption(option => option.setName('quiet').setDescription('Make the response only visible to you').setRequired(false)),

  async execute(interaction) {
    const quiet = interaction.options.getBoolean('quiet') ?? false;
    await interaction.deferReply({ flags: quiet ? 64 : undefined });
    await sendDownloadedMedia(interaction, interaction.options.getString('url'));
  },

  sendDownloadedMedia,
  compressionPlan,
  compress,
  createScrapeEmbed,
  engagementSummary,
};
