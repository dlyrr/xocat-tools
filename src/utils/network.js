const dns = require('dns').promises;
const net = require('net');

function isPrivateAddress(rawAddress) {
  const address = String(rawAddress || '').toLowerCase().replace(/^\[|\]$/g, '').split('%')[0];
  if (net.isIPv4(address)) {
    const [a, b, c] = address.split('.').map(Number);
    return a === 0
      || a === 10
      || a === 127
      || (a === 100 && b >= 64 && b <= 127)
      || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168)
      || (a === 192 && b === 0 && c === 0)
      || (a === 192 && b === 0 && c === 2)
      || (a === 198 && [18, 19].includes(b))
      || (a === 198 && b === 51 && c === 100)
      || (a === 203 && b === 0 && c === 113)
      || a >= 224;
  }

  if (net.isIPv6(address)) {
    if (address === '::' || address === '::1') return true;
    if (/^(fc|fd)/.test(address) || /^fe[89ab]/.test(address) || /^ff/.test(address)) return true;
    if (address.startsWith('2001:db8:')) return true;
    if (address.startsWith('::ffff:')) {
      const mapped = address.slice(7);
      return net.isIPv4(mapped) ? isPrivateAddress(mapped) : true;
    }
  }

  return false;
}

async function resolvePublicUrl(value, options = {}) {
  const input = /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`;
  const parsed = new URL(input);
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('Only HTTP and HTTPS URLs are supported.');
  }
  if (parsed.username || parsed.password) throw new Error('URLs containing credentials are not supported.');
  if (options.forceHttps) parsed.protocol = 'https:';

  const hostname = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!hostname || hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local')) {
    throw new Error('Local and private network addresses are not allowed.');
  }

  if (options.allowedDomains?.length) {
    const allowed = options.allowedDomains.some(domain => hostname === domain || hostname.endsWith(`.${domain}`));
    if (!allowed) throw new Error('That website is not supported by this command.');
  }

  const addresses = net.isIP(hostname)
    ? [{ address: hostname, family: net.isIPv6(hostname) ? 6 : 4 }]
    : await dns.lookup(hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(result => isPrivateAddress(result.address))) {
    throw new Error('Local and private network addresses are not allowed.');
  }

  return { url: parsed.toString(), address: addresses.find(result => result.family === 4) || addresses[0] };
}

function pinnedLookup(address) {
  return (_hostname, options, callback) => {
    if (typeof options === 'function') {
      callback = options;
      options = {};
    }
    if (options?.all) return callback(null, [address]);
    callback(null, address.address, address.family);
  };
}

async function getPublicStream(axios, value, options = {}) {
  let current = value;
  const maxRedirects = options.maxRedirects ?? 5;

  for (let redirect = 0; redirect <= maxRedirects; redirect += 1) {
    const resolved = await resolvePublicUrl(current, { forceHttps: options.forceHttps });
    const response = await axios.get(resolved.url, {
      timeout: options.timeout,
      responseType: 'stream',
      validateStatus: () => true,
      maxRedirects: 0,
      lookup: pinnedLookup(resolved.address),
    });

    if (response.status >= 300 && response.status < 400 && response.headers.location) {
      response.data.destroy();
      if (redirect === maxRedirects) throw new Error('Too many redirects.');
      current = new URL(response.headers.location, resolved.url).toString();
      continue;
    }
    return response;
  }

  throw new Error('Too many redirects.');
}

module.exports = { getPublicStream, isPrivateAddress, resolvePublicUrl };
