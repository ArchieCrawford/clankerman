import "dotenv/config";

// Uses the same endpoint patterns as api/price.js so this script mirrors production behavior.
const apiKey = process.env.ALCHEMY_BASE_API_KEY || process.env.ALCHEMY_PRICE_API_KEY || "demo";
const baseRPC = `https://base-mainnet.g.alchemy.com/v2/${apiKey}`;
const priceBase = `https://api.g.alchemy.com/prices/v1/${apiKey}/tokens/by-address`;

const ownerAddr = process.env.TREASURY_ADDRESS || "0x8D4aB2A3E89EadfDC729204adF863A0Bfc7746F6";
const tokenAddr = (process.env.TOKEN_ADDRESS || "0x1bc0c42215582d5a085795f4badbac3ff36d1bcb").toLowerCase();

async function postJson(method, params, id) {
  const res = await fetch(baseRPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params })
  });

  const text = await res.text();
  if (!res.ok) throw new Error(`RPC ${res.status}: ${text || "no body"}`);
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error(`RPC parse error (${e.message}): ${text || "empty"}`);
  }
}

async function getCurrentPrice(addr) {
  const url = `${priceBase}?addresses[]=${encodeURIComponent(addr)}&network=base-mainnet`;
  const res = await fetch(url, { cache: "no-store" });
  const text = await res.text();
  if (!res.ok) throw new Error(`price ${res.status}: ${text || "no body"}`);
  const json = JSON.parse(text || "{}");
  const entry = json?.data?.[0] || json?.[0];
  const val = entry?.price?.value ?? entry?.price ?? null;
  const priceNum = Number(val);
  if (!Number.isFinite(priceNum)) throw new Error(`invalid price payload: ${text}`);
  return { price: priceNum, raw: json };
}

async function getPriceHistory(addr, days = 7, samples = 24) {
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
  if (!res.ok) throw new Error(`history ${res.status}: ${text || "no body"}`);
  const json = JSON.parse(text || "{}");
  return json?.data?.[0]?.prices || json;
}

async function getTokenData() {
  try {
    if (!apiKey || apiKey === "demo") {
      console.warn("Set ALCHEMY_BASE_API_KEY (or ALCHEMY_PRICE_API_KEY) for real data; demo may fail on Base.");
    }

    const balanceData = await postJson("alchemy_getTokenBalances", [ownerAddr, [tokenAddr]], 1);
    const metadataData = await postJson("alchemy_getTokenMetadata", [tokenAddr], 2);

    let priceData = null;
    try {
      priceData = await getCurrentPrice(tokenAddr);
    } catch (e) {
      console.warn("Price fetch failed:", e.message);
    }

    let historyData = null;
    try {
      historyData = await getPriceHistory(tokenAddr, 7, 24);
    } catch (e) {
      console.warn("History fetch failed:", e.message);
    }

    console.log("--- RESULTS ---");
    console.log("Token Balance (hex):", balanceData.result?.tokenBalances?.[0]?.tokenBalance);
    console.log("Current Price (USD):", priceData?.price ?? "n/a");
    console.log("Symbol:", metadataData.result?.symbol);
    console.log("History samples:", Array.isArray(historyData) ? historyData.length : "n/a");
  } catch (error) {
    console.error("Request failed:", error.message);
  }
}

getTokenData();