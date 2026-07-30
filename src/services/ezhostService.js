// ============================================================
// e-z.host API Service
// Centralized wrapper for all e-z.host endpoints
// Reference: https://github.com/E-Z-Services/e-z-py/blob/main/core.py
// ============================================================
const axios = require('axios');
const FormData = require('form-data');

const BASE_URL = 'https://api.e-z.host';

function getKey() {
  const key = process.env.EZHOST_API_KEY;
  if (!key) throw new Error('EZHOST_API_KEY is not set in .env');
  return key.trim();
}

/**
 * Upload a file buffer to e-z.host
 * @param {Buffer} buffer - The file content
 * @param {string} filename - The filename (e.g. 'image.gif')
 * @param {string} contentType - MIME type (e.g. 'image/gif')
 * @returns {Promise<{imageUrl: string, rawUrl: string, deletionUrl: string}>}
 */
async function uploadFile(buffer, filename, contentType) {
  const form = new FormData();
  form.append('file', buffer, { filename, contentType });

  const res = await axios.post(`${BASE_URL}/files`, form, {
    headers: {
      ...form.getHeaders(),
      'key': getKey(),
    }
  });

  if (!res.data.success) {
    throw new Error(`Upload failed: ${JSON.stringify(res.data)}`);
  }
  return {
    imageUrl: res.data.imageUrl,
    rawUrl: res.data.rawUrl,
    deletionUrl: res.data.deletionUrl,
  };
}

/**
 * Shorten a URL via e-z.host
 * @param {string} url - The URL to shorten
 * @returns {Promise<{shortUrl: string, deletionUrl: string}>}
 */
async function shortenUrl(url) {
  const res = await axios.post(`${BASE_URL}/shortener`, { url }, {
    headers: {
      'key': getKey(),
      'Content-Type': 'application/json',
    }
  });

  if (!res.data.success) {
    throw new Error(`Shorten failed: ${JSON.stringify(res.data)}`);
  }
  return {
    shortUrl: res.data.shortendUrl,
    deletionUrl: res.data.deletionUrl,
  };
}

/**
 * Create a paste on e-z.host
 * @param {string} title - Paste title
 * @param {string} description - Paste description
 * @param {string} text - The text content
 * @param {string} language - Syntax highlighting language (default: 'plaintext')
 * @returns {Promise<{pasteUrl: string, rawUrl: string, deletionUrl: string}>}
 */
async function createPaste(title, description, text, language = 'plaintext') {
  const res = await axios.post(`${BASE_URL}/paste`, {
    title,
    description,
    text,
    language,
  }, {
    headers: {
      'key': getKey(),
      'Content-Type': 'application/json',
    }
  });

  if (!res.data.success) {
    throw new Error(`Paste failed: ${JSON.stringify(res.data)}`);
  }
  return {
    pasteUrl: res.data.pasteUrl,
    rawUrl: res.data.rawUrl,
    deletionUrl: res.data.deletionUrl,
  };
}

module.exports = { uploadFile, shortenUrl, createPaste };
