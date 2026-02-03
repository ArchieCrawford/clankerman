import { ethers } from "ethers";

const V3_POOL_ABI = [
  "function slot0() view returns (uint160,int24,uint16,uint16,uint16,uint8,bool)",
  "function token0() view returns (address)",
  "function token1() view returns (address)"
];

const CLANKER_DEFAULT = "0x1bc0c42215582d5a085795f4badbac3ff36d1bcb";
const WETH_DEFAULT = "0x4200000000000000000000000000000000000006";
const USDC_DEFAULT = "0x833589fcd6edb6e08f4c7c32d4f71b54b5b0e4d";
const BNKR_DEFAULT = process.env.BNKR_ADDRESS || "";
const POOL_DEFAULT = "0xdf43c40188c1a711bc49fa5922198b8d73291800";
const Q192 = BigInt(2) ** BigInt(192);
const ALCHEMY_PRICE_KEY = process.env.ALCHEMY_BASE_API_KEY || process.env.ALCHEMY_PRICE_API_KEY || "";

function getRangeConfig(range) {
  const endTime = new Date();
  const r = (range || "24h").toLowerCase();
  if (r === "4h") return { startTime: new Date(endTime.getTime() - 4 * 60 * 60 * 1000), endTime, sampleCount: 48 };
  if (r === "7d") return { startTime: new Date(endTime.getTime() - 7 * 24 * 60 * 60 * 1000), endTime, sampleCount: 168 };
  if (r === "30d") return { startTime: new Date(endTime.getTime() - 30 * 24 * 60 * 60 * 1000), endTime, sampleCount: 180 };
  return { startTime: new Date(endTime.getTime() - 24 * 60 * 60 * 1000), endTime, sampleCount: 96 };
}

function normalizeHistoryArray(arr) {
  if (!Array.isArray(arr)) return null;
  const out = arr
    .map((p) => {
      const ts = p?.timestamp ?? p?.time ?? p?.t ?? p?.blockTimestamp ?? null;
      const v = p?.value ?? p?.price ?? p?.close ?? p?.open ?? p?.high ?? p?.low ?? p;
      const n = Number(v);
      if (!Number.isFinite(n)) return null;
      return ts ? { timestamp: ts, value: n } : { value: n };
    })
    .filter(Boolean);
  return out.length ? out : null;
}

async function getAlchemyPrice(tokenAddress, { range = "24h" } = {}) {
  if (!ALCHEMY_PRICE_KEY) throw new Error("ALCHEMY_BASE_API_KEY missing");

  const priceUrl = `https://api.g.alchemy.com/prices/v1/${ALCHEMY_PRICE_KEY}/tokens/by-address`;
  const historyUrl = `https://api.g.alchemy.com/prices/v1/${ALCHEMY_PRICE_KEY}/tokens/historical`;

  const { startTime, endTime, sampleCount } = getRangeConfig(range);

  // Current price via POST (Alchemy requires addresses array)
  const priceRes = await fetch(priceUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
    body: JSON.stringify({
      addresses: [{ network: "base-mainnet", address: tokenAddress }]
    })
  });
  const priceText = await priceRes.text();
  if (!priceRes.ok) throw new Error(`Alchemy price http ${priceRes.status}: ${priceText || "no body"}`);
  const priceJson = JSON.parse(priceText || "{}");
  const priceEntry = priceJson?.data?.[0] || priceJson?.[0];
  const priceVal = priceEntry?.prices?.[0]?.value ?? priceEntry?.price?.value ?? priceEntry?.price ?? null;
  const priceNum = Number(priceVal);
  if (!Number.isFinite(priceNum)) throw new Error("Alchemy price missing");

  // History via POST using requested range window
  const historyRes = await fetch(historyUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
    body: JSON.stringify({
      address: tokenAddress,
      network: "base-mainnet",
      startTime: startTime.toISOString(),
      endTime: endTime.toISOString(),
      sampleCount
    })
  });
  const historyText = await historyRes.text();
  if (!historyRes.ok) throw new Error(`Alchemy history http ${historyRes.status}: ${historyText || "no body"}`);
  const historyJson = JSON.parse(historyText || "{}");
  const historyData = Array.isArray(historyJson?.data) ? historyJson.data[0] : historyJson?.data?.[0] || historyJson?.data || null;
  const rawHistory = historyData?.prices || historyData?.priceHistory || historyData?.history || historyJson?.prices || null;
  const history = normalizeHistoryArray(rawHistory);

  return { price: priceNum, history };
}

function computePrice(sqrtPriceX96) {
  const priceX192 = sqrtPriceX96 * sqrtPriceX96;
  return Number(priceX192) / Number(Q192);
}

export default async function handler(req, res) {
  try {
    const rpcUrl = process.env.ALCHEMY_BASE_URL;
    const poolAddress = process.env.CLANKER_USDC_V3_POOL || POOL_DEFAULT;
    const clankerToken = (process.env.CLANKER_TOKEN || CLANKER_DEFAULT).toLowerCase();
    const wethToken = (process.env.WETH_TOKEN || WETH_DEFAULT).toLowerCase();
    const usdcToken = (process.env.USDC_TOKEN || USDC_DEFAULT).toLowerCase();
    const range = (req.query?.range || "24h").toLowerCase();

    const requested = (req.query?.token || req.query?.address || "").toLowerCase();
    const targetAddr = requested === "bnkr"
      ? (BNKR_DEFAULT || "").toLowerCase()
      : requested === "weth"
      ? wethToken
      : requested === "usdc"
      ? usdcToken
      : (requested || clankerToken);
    if (!targetAddr) return res.status(400).json({ error: "token address missing" });
    if (requested === "bnkr" && !BNKR_DEFAULT) {
      return res.status(400).json({ error: "BNKR_ADDRESS not set" });
    }

    try {
      const alch = await getAlchemyPrice(targetAddr, { range });
      if (alch?.price) {
        return res.json({ price: alch.price, history: alch.history || null, source: "alchemy" });
      }
    } catch (e) {
      // fall through to pool
      // If Alchemy failed and no pool fallback, surface message
      if (targetAddr !== clankerToken) {
        return res.status(500).json({ error: e.message || "price error" });
      }
    }

    if (!rpcUrl) return res.status(500).json({ error: "ALCHEMY_BASE_URL missing" });

    // Pool fallback only valid for CLANKER pool
    if (targetAddr !== clankerToken) {
      return res.status(500).json({ error: "No pool price for requested token" });
    }

    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const pool = new ethers.Contract(poolAddress, V3_POOL_ABI, provider);

    const [slot0, token0, token1] = await Promise.all([pool.slot0(), pool.token0(), pool.token1()]);
    const sqrtPriceX96 = slot0[0];
    const priceRaw = computePrice(sqrtPriceX96);

    if (!Number.isFinite(priceRaw) || priceRaw <= 0) {
      throw new Error("invalid pool price");
    }

    let price = priceRaw;
    if (token0.toLowerCase() === clankerToken) {
      price = 1 / priceRaw;
    }

    res.json({ price, history: null, source: "pool" });
  } catch (err) {
    res.status(500).json({ error: err.message || "error" });
  }
}
