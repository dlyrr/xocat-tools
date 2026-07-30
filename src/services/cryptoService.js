// ============================================================
// Cryptocurrency Service — CoinGecko + Blockchain APIs
// ============================================================
const axios = require('axios');
const { cryptoChains } = require('../utils/constants');

const coinGecko = axios.create({
  baseURL: 'https://api.coingecko.com/api/v3',
  timeout: 10000,
});

// ---- Price Data ----

async function getCryptoPrice(coinId) {
  const { data } = await coinGecko.get('/coins/markets', {
    params: {
      vs_currency: 'usd',
      ids: coinId,
      order: 'market_cap_desc',
      sparkline: true,
      price_change_percentage: '1h,24h,7d',
    },
  });
  return data[0] || null;
}

async function getCryptoPriceHistory(coinId, days = 7) {
  const { data } = await coinGecko.get(`/coins/${coinId}/market_chart`, {
    params: { vs_currency: 'usd', days },
  });
  return data;
}

// ---- Bitcoin Address ----

async function getBitcoinAddress(address) {
  const { data } = await axios.get(`https://blockchain.info/rawaddr/${address}`, {
    params: { limit: 5 },
    timeout: 10000,
  });
  return {
    address: data.address,
    balance: data.final_balance / 1e8, // Satoshi to BTC
    totalReceived: data.total_received / 1e8,
    totalSent: data.total_sent / 1e8,
    txCount: data.n_tx,
    recentTxs: (data.txs || []).slice(0, 5).map(tx => ({
      hash: tx.hash,
      time: tx.time,
      result: tx.result / 1e8,
      fee: tx.fee / 1e8,
    })),
  };
}

// ---- Ethereum Address ----

async function getEthereumAddress(address) {
  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
    throw new Error('Invalid Ethereum address.');
  }

  const rpcUrl = process.env.ETHEREUM_RPC_URL || 'https://ethereum-rpc.publicnode.com';
  const { data } = await axios.post(rpcUrl, {
    jsonrpc: '2.0',
    id: 1,
    method: 'eth_getBalance',
    params: [address, 'latest'],
  }, { timeout: 10000 });

  if (data.error) throw new Error(data.error.message || 'Ethereum RPC returned an error.');
  if (!/^0x[a-fA-F0-9]+$/.test(data.result || '')) {
    throw new Error('Ethereum RPC returned an invalid balance.');
  }

  return {
    address,
    balance: formatWeiAsEther(BigInt(data.result)),
  };
}

function formatWeiAsEther(wei) {
  const base = 10n ** 18n;
  const whole = wei / base;
  const fraction = (wei % base).toString().padStart(18, '0').slice(0, 8).replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

// ---- Litecoin Address ----

async function getLitecoinAddress(address) {
  const { data } = await axios.get(`https://api.blockcypher.com/v1/ltc/main/addrs/${address}/balance`, {
    timeout: 10000,
  });
  return {
    address,
    balance: data.balance / 1e8,
    totalReceived: data.total_received / 1e8,
    totalSent: data.total_sent / 1e8,
    txCount: data.n_tx || 0,
  };
}

// ---- Solana Address ----

async function getSolanaAddress(address) {
  const { data } = await axios.post('https://api.mainnet-beta.solana.com', {
    jsonrpc: '2.0',
    id: 1,
    method: 'getBalance',
    params: [address],
  }, { timeout: 10000 });
  if (data.error) throw new Error(data.error.message || 'Solana RPC returned an error.');
  if (!Number.isFinite(data.result?.value)) throw new Error('Solana RPC returned an invalid balance.');
  return {
    address,
    balance: data.result.value / 1e9, // Lamports to SOL
  };
}

// ---- Transaction Lookup ----

async function getBitcoinTx(txHash) {
  const { data } = await axios.get(`https://blockchain.info/rawtx/${txHash}`, { timeout: 10000 });
  return {
    hash: data.hash,
    confirmed: data.block_height > 0,
    blockHeight: data.block_height,
    time: data.time,
    fee: data.fee / 1e8,
    inputs: data.inputs?.length || 0,
    outputs: data.out?.length || 0,
    totalOutput: data.out?.reduce((a, o) => a + o.value, 0) / 1e8 || 0,
  };
}

// ---- Currency Exchange ----

async function convertCurrency(amount, from, to) {
  const apiKey = process.env.EXCHANGE_API_KEY;
  if (!apiKey) throw new Error('EXCHANGE_API_KEY not configured');

  const { data } = await axios.get(
    `https://v6.exchangerate-api.com/v6/${apiKey}/pair/${from}/${to}/${amount}`,
    { timeout: 10000 }
  );
  return {
    from,
    to,
    amount,
    result: data.conversion_result,
    rate: data.conversion_rate,
  };
}

// Also support crypto conversion via CoinGecko
async function convertCrypto(amount, fromCrypto, toCurrency = 'usd') {
  const { data } = await coinGecko.get('/simple/price', {
    params: { ids: fromCrypto, vs_currencies: toCurrency },
  });
  const rate = data[fromCrypto]?.[toCurrency];
  if (!rate) throw new Error('Unsupported currency pair');
  return { amount, from: fromCrypto, to: toCurrency, rate, result: amount * rate };
}

module.exports = {
  getCryptoPrice,
  getCryptoPriceHistory,
  getBitcoinAddress,
  getEthereumAddress,
  getLitecoinAddress,
  getSolanaAddress,
  getBitcoinTx,
  convertCurrency,
  convertCrypto,
};
