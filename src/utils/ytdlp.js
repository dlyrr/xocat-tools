// ============================================================
// yt-dlp Binary Resolution
// ============================================================
// The repo ships a Windows build for local development. Linux hosts (Wispbyte,
// any Pterodactyl egg) need the static Linux build instead, so resolve the
// binary per platform rather than hardcoding the .exe.
const fs = require('fs');
const path = require('path');

const BIN_DIR = path.resolve(__dirname, '../../bin');

// Official yt-dlp release asset names, keyed by Node's platform string.
const BUNDLED_BINARIES = {
  win32: 'yt-dlp.exe',
  linux: 'yt-dlp_linux',
  darwin: 'yt-dlp_macos',
};

function resolveYtDlpPath() {
  // An explicit override wins — useful when the host installs yt-dlp globally.
  const override = process.env.YTDLP_PATH?.trim();
  if (override) return override;

  const bundled = BUNDLED_BINARIES[process.platform];
  if (bundled) {
    const bundledPath = path.join(BIN_DIR, bundled);
    if (fs.existsSync(bundledPath)) return bundledPath;
  }

  // Fall back to whatever is on PATH so a system package still works.
  return process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp';
}

const YT_DLP = resolveYtDlpPath();

// Sent as --user-agent. Kept platform-neutral so a Linux host does not
// advertise itself as Windows to every extractor.
const USER_AGENT = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

// True when the resolved path is a bundled binary we can stat. A bare command
// name resolved from PATH cannot be checked without spawning it.
function isBundled() {
  return path.isAbsolute(YT_DLP);
}

function ytDlpExists() {
  return !isBundled() || fs.existsSync(YT_DLP);
}

module.exports = { YT_DLP, USER_AGENT, ytDlpExists };
