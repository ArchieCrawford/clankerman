import "dotenv/config";

// Uses Base mainnet. Provide ALCHEMY_BASE_API_KEY in .env; falls back to demo if missing (demo is rate-limited and may not support Base).
const apiKey = process.env.ALCHEMY_BASE_API_KEY || process.env.ALCHEMY_PRICE_API_KEY || "demo";
const baseURL = `https://base-mainnet.g.alchemy.com/v2/${apiKey}`;

// Tokenbot (Clanker) owner and token addresses
const ownerAddr = "0x8D4aB2A3E89EadfDC729204adF863A0Bfc7746F6";
const tokenAddr = "0x1bc0c42215582d5a085795f4badbac3ff36d1bcb"; // CLANKER
const priceBase = `https://api.g.alchemy.com/prices/v1/${apiKey}/tokens/by-address`;

async function postJson(method, params, id) {
  const res = await fetch(baseURL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params })
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${text || "no body"}`);
  }
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error(`Parse error (${e.message}): ${text || "empty body"}`);
  }
}

async function getCurrentPrice(addr) {
  const url = `${priceBase}?addresses[]=${encodeURIComponent(addr)}&network=base-mainnet`;
  const res = await fetch(url, { cache: "no-store" });
  const text = await res.text();
  if (!res.ok) throw new Error(`price HTTP ${res.status}: ${text || "no body"}`);
  const json = JSON.parse(text);
  const entry = json?.data?.[0] || json?.[0];
  const val = entry?.price?.value ?? entry?.price ?? null;
  const n = Number(val);
  if (!Number.isFinite(n)) throw new Error(`price missing/invalid: ${text}`);
  return { price: n, raw: json };
}

async function getPriceHistory(addr, days = 7, samples = 24) {
  // Alchemy price API supports historical sampling; if unsupported on your plan this will error and we catch it.
  const end = new Date();
  const start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000);
  const url =
    `${priceBase}?addresses[]=${encodeURIComponent(addr)}` +
    `&network=base-mainnet` +
    `&startDate=${encodeURIComponent(start.toISOString())}` +
    `&endDate=${encodeURIComponent(end.toISOString())}` +
    `&sampleCount=${samples}`;
  const res = await fetch(url, { cache: "no-store" });
  const text = await res.text();
  if (!res.ok) throw new Error(`price history HTTP ${res.status}: ${text || "no body"}`);
  const json = JSON.parse(text);
  return json;
}

async function getTokenData() {
  try {
    if (!apiKey || apiKey === "demo") {
      console.warn("Warning: set ALCHEMY_BASE_API_KEY in .env; demo key may not work on Base.");
    }

    // Get token balances for the wallet
    const balanceData = await postJson("alchemy_getTokenBalances", [ownerAddr, [tokenAddr]], 1);

    // Get token metadata (decimals, symbol)
    const metadataData = await postJson("alchemy_getTokenMetadata", [tokenAddr], 2);

    // Current price
    let priceData = null;
    try {
      priceData = await getCurrentPrice(tokenAddr);
    } catch (e) {
      console.warn("Price fetch failed:", e.message);
    }

    // Price history (7d, 24 samples)
    let historyData = null;
    try {
      historyData = await getPriceHistory(tokenAddr, 7, 24);
    } catch (e) {
      console.warn("Price history fetch failed:", e.message);
    }

    console.log("Token Balances:");
    console.dir(balanceData.result, { depth: null });
    console.log("Token Metadata:");
    console.dir(metadataData.result, { depth: null });
    console.log("Current Price:");
    console.dir(priceData, { depth: null });
    console.log("Price History (last 7d):");
    console.dir(historyData, { depth: null });
  } catch (error) {
    console.error("Request failed:", error.message);
  }
}

getTokenData();
