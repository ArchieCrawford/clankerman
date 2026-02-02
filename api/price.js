import { ethers } from "ethers";

const V3_POOL_ABI = [
  "function slot0() view returns (uint160,int24,uint16,uint16,uint16,uint8,bool)",
  "function token0() view returns (address)",
  "function token1() view returns (address)"
];

const CLANKER_DEFAULT = "0x1bc0c42215582d5a085795f4badbac3ff36d1bcb";
const POOL_DEFAULT = "0xdf43c40188c1a711bc49fa5922198b8d73291800";
const Q192 = BigInt(2) ** BigInt(192);
const ALCHEMY_PRICE_KEY = process.env.ALCHEMY_BASE_API_KEY || process.env.ALCHEMY_PRICE_API_KEY || "";

async function getAlchemyPrice(tokenAddress) {
  if (!ALCHEMY_PRICE_KEY) return null;
  const url =
    `https://api.g.alchemy.com/prices/v1/${ALCHEMY_PRICE_KEY}/tokens/by-address` +
    `?addresses[]=${encodeURIComponent(tokenAddress)}` +
    `&network=base-mainnet`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) return null;
  const json = await res.json();
  // Expected shape: { data: [ { price: { value: number } } ] }
  const entry = json?.data?.[0] || json?.[0];
  const val = entry?.price?.value ?? entry?.price ?? null;
  const n = Number(val);
  return Number.isFinite(n) ? n : null;
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

    // Prefer Alchemy Price API if available
    const alchPrice = await getAlchemyPrice(clankerToken);
    if (alchPrice != null && Number.isFinite(alchPrice)) {
      return res.json({ price: alchPrice });
    }

    if (!rpcUrl) return res.status(500).json({ error: "ALCHEMY_BASE_URL missing" });

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

    res.json({ price });
  } catch (err) {
    res.status(500).json({ error: err.message || "error" });
  }
}
