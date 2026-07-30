const axios = require('axios');

const http = axios.create({
  timeout: 12000,
  headers: { 'User-Agent': 'xocat-discord-bot/1.0' },
  maxRedirects: 5,
});

function addQuiet(builder) {
  return builder.addBooleanOption(option => option
    .setName('quiet')
    .setDescription('Make the response only visible to you')
    .setRequired(false));
}

function truncate(value, max = 1024) {
  const text = String(value ?? '').trim();
  if (!text) return 'Not available';
  return text.length <= max ? text : `${text.slice(0, Math.max(0, max - 1))}…`;
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? new Intl.NumberFormat('en-US', { notation: parsed >= 1e6 ? 'compact' : 'standard', maximumFractionDigits: 1 }).format(parsed) : 'Unknown';
}

function date(value) {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? `<t:${Math.floor(parsed / 1000)}:D>` : 'Unknown';
}

function dateTime(value) {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? `<t:${Math.floor(parsed / 1000)}:f>` : 'Unknown';
}

function url(value) {
  try {
    const parsed = new URL(value);
    return ['http:', 'https:'].includes(parsed.protocol) ? parsed.toString() : null;
  } catch {
    return null;
  }
}

function apiError(error, fallback = 'The service could not complete that request.') {
  if (error?.response?.status === 404) return 'Nothing matching that request was found.';
  if (error?.response?.status === 429) return 'That service is rate-limiting requests. Try again shortly.';
  if (error?.code === 'ECONNABORTED') return 'The service took too long to respond. Try again shortly.';
  const message = error?.response?.data?.message || error?.response?.data?.error?.message;
  return truncate(message || fallback, 500);
}

function quiet(interaction) {
  return interaction.options.getBoolean('quiet') ?? false;
}

module.exports = { http, addQuiet, truncate, number, date, dateTime, url, apiError, quiet };
