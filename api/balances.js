const CLANKER_DEFAULT = "0x1bc0c42215582d5a085795f4badbac3ff36d1bcb";
const WETH_DEFAULT = "0x4200000000000000000000000000000000000006";
const USDC_DEFAULT = "0x833589fcd6edb6e08f4c7c32d4f71b54b5b0e4d";
const BASESCAN_BASE = process.env.BASESCAN_API_BASE || "https://api.etherscan.io/v2/api";
const CHAIN_ID = process.env.BASE_CHAIN_ID || "8453";
const ALCHEMY_KEY = process.env.ALCHEMY_BASE_API_KEY || process.env.ALCHEMY_PRICE_API_KEY || "";
const ALCHEMY_BASE_URL = process.env.ALCHEMY_BASE_URL || (ALCHEMY_KEY ? `https://base-mainnet.g.alchemy.com/v2/${ALCHEMY_KEY}` : "");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function buildBaseScanUrl(module, action, extraParams = {}, apiKey = "") {
  const params = new URLSearchParams({
    chainid: String(CHAIN_ID),
    module,
    action,
    apikey: apiKey
  });
  Object.entries(extraParams).forEach(([key, value]) => {
    if (value === undefined || value === null) return;
    params.set(key, String(value));
  });
  return `${BASESCAN_BASE}?${params.toString()}`;
}

function extractBaseScanError(json) {
  const msg = json?.message || json?.result || "basescan error";
  return typeof msg === "string" ? msg : JSON.stringify(msg);
}

async function fetchBaseScanJson(url) {
  const delays = [250, 750, 1750];
  let lastError = null;
  for (let i = 0; i < delays.length; i += 1) {
    const res = await fetch(url, { cache: "no-store" });
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text || "{}");
    } catch (_) {
      json = null;
    }

    if (res.ok && json?.status === "1") return json;

    const message = json ? extractBaseScanError(json) : (text || "basescan error");
    const isRateLimit = res.status === 429 || /rate limit/i.test(message);
    lastError = new Error(`basescan http ${res.status}: ${message}`);

    if (isRateLimit && i < delays.length - 1) {
      await sleep(delays[i]);
      continue;
    }
    throw lastError;
  }
  throw lastError || new Error("basescan error");
}

async function fetchBalance(url) {
  const json = await fetchBaseScanJson(url);
  return json.result;
}

// PRO endpoint; returns token info including divisor (decimals). We use it opportunistically when available.
async function fetchTokenInfoDecimals(apiKey, contract) {
  const url = buildBaseScanUrl("token", "tokeninfo", { contractaddress: contract }, apiKey);
  const json = await fetchBaseScanJson(url);
  const first = Array.isArray(json.result) ? json.result[0] : null;
  const div = first?.divisor ?? first?.TokenDivisor ?? first?.tokenDivisor;
  const dec = div != null ? Number(div) : null;
  if (!Number.isFinite(dec)) return null;
  if (dec < 0 || dec > 36) return null;
  return dec;
}

async function rpcCall(method, params) {
  if (!ALCHEMY_BASE_URL) throw new Error("alchemy url missing");
  const res = await fetch(ALCHEMY_BASE_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params })
  });
  if (!res.ok) throw new Error(`rpc http ${res.status}`);
  const json = await res.json();
  if (json.error) throw new Error(json.error.message || "rpc error");
  return json.result;
}

function padAddress(addr) {
  return addr.toLowerCase().replace(/^0x/, "").padStart(64, "0");
}

async function getNativeAlchemy(address) {
  const res = await rpcCall("eth_getBalance", [address, "latest"]);
  return BigInt(res || "0").toString();
}

async function getTokenAlchemy(token, address) {
  const data = "0x70a08231" + padAddress(address);
  const res = await rpcCall("eth_call", [{ to: token, data }, "latest"]);
  return BigInt(res || "0").toString();
}

async function getTokenDecimalsRpc(token) {
  // decimals() selector 0x313ce567
  const data = "0x313ce567";
  const res = await rpcCall("eth_call", [{ to: token, data }, "latest"]);
  if (!res) return null;
  try {
    return Number(BigInt(res));
  } catch (_) {
    return null;
  }
}

function formatBalance(raw, decimals) {
  const big = BigInt(raw || "0");
  const denom = BigInt(10) ** BigInt(decimals);
  const whole = big / denom;
  const frac = big % denom;
  const fracStr = frac.toString().padStart(decimals, "0").replace(/0+$/, "");
  return fracStr ? `${whole}.${fracStr}` : whole.toString();
}

export default async function handler(req, res) {
  try {
    const address = (req.query?.address || process.env.TREASURY_ADDRESS || "").trim();
    if (!address) {
      return res.status(400).json({ error: "address is required" });
    }
    if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
      return res.status(400).json({ error: "invalid address" });
    }
    const apiKey = process.env.BASESCAN_API_KEY;

    const tokenMeta = [
      { symbol: "CLANKER", address: process.env.CLANKER_TOKEN || CLANKER_DEFAULT, decimals: 18 },
      { symbol: "WETH", address: process.env.WETH_TOKEN || WETH_DEFAULT, decimals: 18 },
      { symbol: "USDC", address: process.env.USDC_TOKEN || USDC_DEFAULT, decimals: 6 }
    ];

    const filterSymbols = (req.query?.symbols || "")
      .split(",")
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);

    const tokens = filterSymbols.length
      ? tokenMeta.filter((t) => filterSymbols.includes(t.symbol))
      : tokenMeta;

    let nativeRaw;
    if (apiKey) {
      const nativeUrl = buildBaseScanUrl("account", "balance", { address, tag: "latest" }, apiKey);
      nativeRaw = await fetchBalance(nativeUrl);
    } else if (ALCHEMY_BASE_URL) {
      nativeRaw = await getNativeAlchemy(address);
    } else {
      return res.status(500).json({ error: "No balance provider (BASESCAN_API_KEY or ALCHEMY_BASE_URL)" });
    }

    const tokenBalances = [];
    for (const t of tokens) {
      // throttle slightly to avoid hammering BaseScan
      await sleep(50);
      try {
        let raw;
        if (apiKey) {
          const url = buildBaseScanUrl(
            "account",
            "tokenbalance",
            { contractaddress: t.address, address, tag: "latest" },
            apiKey
          );
          raw = await fetchBalance(url);
        } else {
          raw = await getTokenAlchemy(t.address, address);
        }

        let decimals = t.decimals;
        if (!Number.isFinite(decimals) && apiKey) {
          try {
            decimals = await fetchTokenInfoDecimals(apiKey, t.address);
          } catch (_) {
            decimals = null;
          }
        }

        // RPC fallback when tokeninfo is unavailable or no API key
        if (!Number.isFinite(decimals) && ALCHEMY_BASE_URL) {
          try {
            decimals = await getTokenDecimalsRpc(t.address);
          } catch (_) {
            decimals = null;
          }
        }

        if (!Number.isFinite(decimals)) decimals = 18;

        tokenBalances.push({
          symbol: t.symbol,
          address: t.address,
          decimals,
          balanceRaw: raw,
          balance: formatBalance(raw, decimals)
        });
      } catch (e) {
        tokenBalances.push({ symbol: t.symbol, address: t.address, decimals: t.decimals, error: e.message || "error" });
      }
    }

    return res.status(200).json({
      address,
      native: {
        balanceRaw: nativeRaw,
        balance: formatBalance(nativeRaw, 18),
        decimals: 18
      },
      tokens: tokenBalances
    });
  } catch (e) {
    return res.status(500).json({ error: e.message || "error" });
  }
}
