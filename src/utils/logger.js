const supportsColor = process.env.NO_COLOR == null
  && (process.env.FORCE_COLOR != null || Boolean(process.stdout.isTTY));

const ANSI = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  cyan: '\x1b[36m',
  brightCyan: '\x1b[96m',
  blue: '\x1b[94m',
  green: '\x1b[92m',
  yellow: '\x1b[93m',
  red: '\x1b[91m',
  magenta: '\x1b[95m',
  white: '\x1b[97m',
};

function paint(code, value) {
  return supportsColor ? `${code}${value}${ANSI.reset}` : String(value);
}

const color = Object.fromEntries(
  Object.entries(ANSI)
    .filter(([name]) => name !== 'reset')
    .map(([name, code]) => [name, value => paint(code, value)]),
);

function timestamp() {
  return new Date().toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function format(scope, message, tone) {
  const time = color.dim(timestamp());
  const label = tone(`[${String(scope).toUpperCase()}]`.padEnd(12));
  return `${time} ${label} ${message}`;
}

function banner() {
  const top = color.brightCyan('╭────────────────────────────────────────────╮');
  const bottom = color.blue('╰────────────────────────────────────────────╯');
  const title = `${color.bold(color.white('SANTI.TOOLS'))}  ${color.magenta('DISCORD MULTIBOT')}`;
  const titlePadding = ' '.repeat(13);

  process.stdout.write(`\n${top}\n`);
  process.stdout.write(`${color.cyan('│')}  ${title}${titlePadding}${color.cyan('│')}\n`);
  process.stdout.write(`${color.blue('│')}  ${color.dim('social · utility · games · automation')}     ${color.blue('│')}\n`);
  process.stdout.write(`${bottom}\n\n`);
}

function info(scope, message) {
  console.log(format(scope, message, color.cyan));
}

function success(scope, message) {
  console.log(format(scope, message, color.green));
}

function warn(scope, message) {
  console.warn(format(scope, message, color.yellow));
}

function error(scope, message, detail) {
  console.error(format(scope, message, color.red));
  if (detail) {
    const value = detail instanceof Error ? (detail.stack || detail.message) : String(detail);
    console.error(color.dim(value));
  }
}

module.exports = { banner, color, error, info, success, supportsColor, warn };
