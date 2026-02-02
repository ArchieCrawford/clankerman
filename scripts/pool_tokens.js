import "dotenv/config";
import { ethers } from "ethers";

const RPC_URL = process.env.WSS_RPC_URL || process.env.RPC_URL;
if (!RPC_URL) {
  console.error("Missing WSS_RPC_URL or RPC_URL in .env");
  process.exit(1);
}

const V3_POOL_ABI = [
  "function token0() view returns (address)",
  "function token1() view returns (address)",
  "function fee() view returns (uint24)",
  "function slot0() view returns (uint160 sqrtPriceX96,int24 tick,uint16,uint16,uint16,uint8,bool)"
];

const V2_PAIR_ABI = [
  "function token0() view returns (address)",
  "function token1() view returns (address)"
];

const args = process.argv.slice(2).filter(Boolean).flatMap((a) => a.split(",").map((s) => s.trim()));
if (!args.length) {
  console.error("Usage: npm run pool-tokens -- 0xPool1 0xPool2");
  console.error("   or: npm run pool-tokens -- 0xPool1,0xPool2");
  process.exit(1);
}

const provider = RPC_URL.startsWith("wss://")
  ? new ethers.WebSocketProvider(RPC_URL)
  : new ethers.JsonRpcProvider(RPC_URL);

async function inspectPool(addr) {
  const pool = ethers.getAddress(addr);

  // Try V3
  try {
    const c = new ethers.Contract(pool, V3_POOL_ABI, provider);
    const [t0, t1, fee] = await Promise.all([c.token0(), c.token1(), c.fee()]);
    return { pool, token0: ethers.getAddress(t0), token1: ethers.getAddress(t1), fee: Number(fee), kind: "v3" };
  } catch (_) {
    // fall through
  }

  // Try V2/Aerodrome
  try {
    const c = new ethers.Contract(pool, V2_PAIR_ABI, provider);
    const [t0, t1] = await Promise.all([c.token0(), c.token1()]);
    return { pool, token0: ethers.getAddress(t0), token1: ethers.getAddress(t1), fee: null, kind: "v2" };
  } catch (e) {
    throw new Error(e?.message || "Unable to read token0/token1 with v2 or v3 ABI");
  }
}

async function main() {
  for (const p of args) {
    try {
      const row = await inspectPool(p);
      console.log(JSON.stringify(row, null, 2));
    } catch (e) {
      console.error(`Failed for ${p}:`, e?.message || e);
    }
  }
  provider.destroy?.();
}

main().catch((e) => {
  console.error(e?.message || e);
  process.exit(1);
});
