import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { ethers } from "ethers";

const log = (...args) => console.log(new Date().toISOString(), ...args);

const RPC_URL = process.env.WSS_RPC_URL || process.env.RPC_URL;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
const TREASURY_ADDR = (process.env.TREASURY_ADDRESS || "").trim();
const TOKEN_LIST = (process.env.TREASURY_TOKENS || "").split(",").map((s) => s.trim()).filter(Boolean);

if (!RPC_URL) throw new Error("Missing WSS_RPC_URL or RPC_URL in .env");
if (!SUPABASE_URL || !SUPABASE_KEY) throw new Error("Missing Supabase URL/key in .env");
if (!TREASURY_ADDR) throw new Error("Missing TREASURY_ADDRESS in .env");

const provider = RPC_URL.startsWith("wss://") ? new ethers.WebSocketProvider(RPC_URL) : new ethers.JsonRpcProvider(RPC_URL);
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const ERC20_ABI = [
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function balanceOf(address) view returns (uint256)"
];

async function getTokenMeta(addr) {
  const c = new ethers.Contract(addr, ERC20_ABI, provider);
  let symbol = "";
  let decimals = 18;
  try {
    symbol = await c.symbol();
  } catch (_) {}
  try {
    decimals = Number(await c.decimals());
  } catch (_) {}
  return { symbol, decimals };
}

async function getBalances() {
  const balances = [];
  const nativeBal = await provider.getBalance(TREASURY_ADDR);
  balances.push({ token: "ETH", address: "native", amount: ethers.formatEther(nativeBal) });

  for (const t of TOKEN_LIST) {
    try {
      const tokenAddr = ethers.getAddress(t);
      const meta = await getTokenMeta(tokenAddr);
      const c = new ethers.Contract(tokenAddr, ERC20_ABI, provider);
      const bal = await c.balanceOf(TREASURY_ADDR);
      balances.push({ token: meta.symbol || tokenAddr, address: tokenAddr, amount: ethers.formatUnits(bal, meta.decimals) });
    } catch (e) {
      balances.push({ token: t, address: t, error: e?.message || String(e) });
    }
  }
  return balances;
}

async function recentTrades(limit = 50) {
  const { data, error } = await supabase
    .from("trades")
    .select("tx_hash,block_number,block_time,pool_address,side,clanker_amount,quote_symbol,quote_amount,status")
    .eq("maker", TREASURY_ADDR.toLowerCase())
    .order("block_number", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data || [];
}

async function main() {
  log("Treasury:", TREASURY_ADDR);
  const balances = await getBalances();
  log("Balances:");
  balances.forEach((b) => {
    if (b.error) log(`  ${b.token}: error ${b.error}`);
    else log(`  ${b.token} (${b.address}): ${b.amount}`);
  });

  const trades = await recentTrades();
  log(`Recent trades as maker (${trades.length}):`);
  trades.forEach((t) => {
    log(
      `  block=${t.block_number} status=${t.status} side=${t.side} cl=${t.clanker_amount ?? ""} quote=${t.quote_amount ?? ""} ${t.quote_symbol ?? ""} tx=${t.tx_hash}`
    );
  });

  provider.destroy?.();
}

main().catch((e) => {
  console.error(e?.message || e);
  process.exit(1);
});
