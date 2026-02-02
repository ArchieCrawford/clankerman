import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { ethers } from "ethers";

// Basic timestamped logger used across the listener loops.
const ts = () => new Date().toISOString();
const log = {
  info: (...args) => console.log(ts(), "[info]", ...args),
  warn: (...args) => console.warn(ts(), "[warn]", ...args),
  error: (...args) => console.error(ts(), "[error]", ...args)
};

const WSS_RPC_URL = process.env.WSS_RPC_URL;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

const CHAIN = process.env.CHAIN || "base"; // label stored with each trade row
const CONFIRMATIONS = Number(process.env.CONFIRMATIONS || 10); // blocks to wait before marking confirmed
const CLANKER_TOKEN = (process.env.CLANKER_TOKEN || "0x1bc0c42215582d5a085795f4badbac3ff36d1bcb").toLowerCase(); // token we classify buys/sells against
const LOG_CHUNK = Number(process.env.LOG_CHUNK || 8); // max block span per getLogs to satisfy free-tier RPC
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const POOL_ADDRESSES = (process.env.POOL_ADDRESSES || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean)
  .map((addr) => {
    try {
      return ethers.getAddress(addr);
    } catch (e) {
      log.warn(`Invalid pool address skipped: ${addr}`);
      return null;
    }
  })
  .filter(Boolean);

const SWAP_TOPIC = (process.env.SWAP_TOPIC || "").trim().toLowerCase();
const V3_SWAP_TOPIC = "0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67";
const V2_SWAP_TOPIC = "0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822";

if (!WSS_RPC_URL) throw new Error("Missing WSS_RPC_URL");
if (!SUPABASE_URL) throw new Error("Missing SUPABASE_URL");
if (!SUPABASE_SERVICE_ROLE_KEY) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");
if (!POOL_ADDRESSES.length) throw new Error("Missing POOL_ADDRESSES");
if (!SWAP_TOPIC.startsWith("0x")) throw new Error("Missing/invalid SWAP_TOPIC");

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
let provider;
let connecting = false;
const poolMeta = new Map(); // pool -> { token0, token1, token0Symbol, token1Symbol }
const erc20Meta = new Map();

const I_PAIR = ["function token0() view returns (address)", "function token1() view returns (address)"];
const I_ERC20 = ["function symbol() view returns (string)", "function decimals() view returns (uint8)"];

// Persist last-processed block and other state markers.
async function upsertSyncState(key, value) {
  const { error } = await supabase.from("sync_state").upsert({ key, value: String(value) });
  if (error) throw error;
}

// Read stored sync markers; fallback when absent.
async function getSyncState(key, fallback = null) {
  const { data, error } = await supabase.from("sync_state").select("value").eq("key", key).maybeSingle();
  if (error) throw error;
  return data?.value ?? fallback;
}

// Insert a parsed swap; ignore duplicate constraint violations.
async function insertTrade(row) {
  const { error } = await supabase.from("trades").insert(row);
  if (error) {
    if (String(error.message || "").toLowerCase().includes("duplicate")) return;
    if (String(error.code || "") === "23505") return;
    throw error;
  }
}

// Mark pending trades as confirmed once past confirmation depth.
async function markConfirmed(tx_hash) {
  const { error } = await supabase
    .from("trades")
    .update({ status: "confirmed" })
    .eq("tx_hash", tx_hash)
    .eq("status", "pending");
  if (error) throw error;
}

// Subscription filter used for both live stream and backfill queries.
function getFilter() {
  return {
    address: POOL_ADDRESSES,
    topics: [SWAP_TOPIC]
  };
}

const V2_IFACE = new ethers.Interface([
  "event Swap(address indexed sender,uint amount0In,uint amount1In,uint amount0Out,uint amount1Out,address indexed to)"
]);

const V3_IFACE = new ethers.Interface([
  "event Swap(address indexed sender,address indexed recipient,int256 amount0,int256 amount1,uint160 sqrtPriceX96,uint128 liquidity,int24 tick)"
]);

// Decode swap log as V3 (topic match) or V2 (fallback).
function parseSwapLog(log) {
  const topic0 = (log.topics?.[0] || "").toLowerCase();
  if (topic0 === V3_SWAP_TOPIC) {
    const parsed = V3_IFACE.parseLog({ topics: log.topics, data: log.data });
    const args = parsed.args;
    return {
      kind: "v3",
      sender: args.sender,
      recipient: args.recipient,
      amount0: args.amount0.toString(),
      amount1: args.amount1.toString(),
      raw: {
        sqrtPriceX96: args.sqrtPriceX96.toString(),
        liquidity: args.liquidity.toString(),
        tick: Number(args.tick)
      }
    };
  }

  // default to V2-style
  const parsed = V2_IFACE.parseLog({ topics: log.topics, data: log.data });
  const args = parsed.args;
  return {
    kind: "v2",
    sender: args.sender,
    to: args.to,
    amount0In: args.amount0In.toString(),
    amount1In: args.amount1In.toString(),
    amount0Out: args.amount0Out.toString(),
    amount1Out: args.amount1Out.toString()
  };
}

// Cache ERC20 symbol/decimals per token address.
async function getErc20Meta(addr) {
  const key = addr.toLowerCase();
  if (erc20Meta.has(key)) return erc20Meta.get(key);
  const contract = new ethers.Contract(addr, I_ERC20, provider);
  let symbol = "";
  let decimals = 18;
  try {
    symbol = await contract.symbol();
  } catch (e) {
    symbol = "";
  }
  try {
    decimals = Number(await contract.decimals());
  } catch (e) {
    decimals = 18;
  }
  const meta = { symbol, decimals };
  erc20Meta.set(key, meta);
  return meta;
}

// Cache pool token addresses and metadata.
async function getPoolMeta(pool) {
  const key = pool.toLowerCase();
  if (poolMeta.has(key)) return poolMeta.get(key);
  const contract = new ethers.Contract(pool, I_PAIR, provider);
  const token0 = await contract.token0();
  const token1 = await contract.token1();
  const [m0, m1] = await Promise.all([getErc20Meta(token0), getErc20Meta(token1)]);
  const meta = { token0: token0.toLowerCase(), token1: token1.toLowerCase(), token0Symbol: m0.symbol, token1Symbol: m1.symbol, token0Decimals: m0.decimals, token1Decimals: m1.decimals };
  poolMeta.set(key, meta);
  return meta;
}

// Format bigint values into human-readable decimals; fallback to raw on error.
function formatAmount(raw, decimals) {
  try {
    return ethers.formatUnits(raw, decimals);
  } catch (e) {
    return raw;
  }
}

// Determine buy/sell direction vs CLANKER token and produce sized amounts.
function deriveSideAndAmounts(meta, swap) {
  const isClanker0 = meta.token0 === CLANKER_TOKEN;
  const isClanker1 = meta.token1 === CLANKER_TOKEN;
  if (!isClanker0 && !isClanker1) {
    return { side: "unknown", clanker_amount: null, quote_symbol: null, quote_amount: null };
  }

  if (swap.kind === "v3") {
    const clDelta = BigInt(isClanker0 ? swap.amount0 : swap.amount1);
    const quoteDelta = BigInt(isClanker0 ? swap.amount1 : swap.amount0);
    // In V3, amountX > 0 means the pool received tokenX; < 0 means pool sent tokenX.
    let side = "unknown";
    if (clDelta < 0n) side = "buy";
    else if (clDelta > 0n) side = "sell";

    const clDecimals = isClanker0 ? meta.token0Decimals ?? 18 : meta.token1Decimals ?? 18;
    const quoteDecimals = isClanker0 ? meta.token1Decimals ?? 18 : meta.token0Decimals ?? 18;
    const quoteSymbol = isClanker0 ? meta.token1Symbol || "" : meta.token0Symbol || "";

    const clAbs = clDelta < 0n ? -clDelta : clDelta;
    const quoteAbs = quoteDelta < 0n ? -quoteDelta : quoteDelta;

    return {
      side,
      clanker_amount: clAbs ? formatAmount(clAbs, clDecimals) : null,
      quote_symbol: quoteSymbol,
      quote_amount: quoteAbs ? formatAmount(quoteAbs, quoteDecimals) : null
    };
  }

  // V2-style
  let clIn = "0";
  let clOut = "0";
  let quoteIn = "0";
  let quoteOut = "0";
  let quoteSymbol = null;
  let quoteDecimals = 18;

  if (isClanker0) {
    clIn = swap.amount0In;
    clOut = swap.amount0Out;
    quoteIn = swap.amount1In;
    quoteOut = swap.amount1Out;
    quoteSymbol = meta.token1Symbol || "";
    quoteDecimals = meta.token1Decimals ?? 18;
  } else {
    clIn = swap.amount1In;
    clOut = swap.amount1Out;
    quoteIn = swap.amount0In;
    quoteOut = swap.amount0Out;
    quoteSymbol = meta.token0Symbol || "";
    quoteDecimals = meta.token0Decimals ?? 18;
  }

  const clInNum = BigInt(clIn || "0");
  const clOutNum = BigInt(clOut || "0");
  const quoteInNum = BigInt(quoteIn || "0");
  const quoteOutNum = BigInt(quoteOut || "0");

  let side = "unknown";
  if (clOutNum > 0n) side = "buy";
  else if (clInNum > 0n) side = "sell";

  const clDecimals = isClanker0 ? meta.token0Decimals ?? 18 : meta.token1Decimals ?? 18;
  const clAmount = clOutNum > 0n ? clOutNum : clInNum;
  const quoteAmount = quoteOutNum > 0n ? quoteOutNum : quoteInNum;

  return {
    side,
    clanker_amount: clAmount ? formatAmount(clAmount, clDecimals) : null,
    quote_symbol: quoteSymbol,
    quote_amount: quoteAmount ? formatAmount(quoteAmount, quoteDecimals) : null
  };
}

// Historical log pull in small chunks to respect provider limits.
async function backfill(fromBlock, toBlock) {
  log.info(`Backfill start ${fromBlock} -> ${toBlock}`);
  let total = 0;
  let cursor = fromBlock;
  while (cursor <= toBlock) {
    const end = Math.min(cursor + LOG_CHUNK - 1, toBlock);
    try {
      const logs = await provider.getLogs({
        ...getFilter(),
        fromBlock: cursor,
        toBlock: end
      });
      total += logs.length;
      for (const logItem of logs) {
        try {
          await handleLog(logItem, true);
        } catch (e) {
          log.error("backfill log error", e?.message || e);
        }
      }
    } catch (e) {
      log.error("backfill chunk error", `range ${cursor}-${end}`, e?.message || e);
    }
    cursor = end + 1;
    await sleep(150); // small pause to avoid provider rate limits
  }
  log.info(`Backfill done (${total} logs)`);
}

// Process a single swap log: decode, derive amounts, persist, advance sync marker.
async function handleLog(log, isBackfill = false) {
  let meta;
  try {
    meta = await getPoolMeta(log.address);
  } catch (e) {
    log.warn("pool meta error", log.address, e?.message || e);
    return;
  }

  const block = await provider.getBlock(log.blockNumber);
  const txHash = log.transactionHash;

  const swap = parseSwapLog(log);
  const derived = deriveSideAndAmounts(meta, swap);

  const row = {
    chain: CHAIN,
    tx_hash: txHash,
    block_number: log.blockNumber,
    block_time: new Date(block.timestamp * 1000).toISOString(),
    pool_address: (log.address || "").toLowerCase(),
    side: derived.side,
    clanker_amount: derived.clanker_amount,
    quote_symbol: derived.quote_symbol,
    quote_amount: derived.quote_amount,
    maker: (swap.sender || "").toLowerCase(),
    status: "pending",
    raw: {
      logIndex: log.index,
      removed: log.removed,
      backfill: isBackfill,
      swap,
      pool_meta: meta
    }
  };

  await insertTrade(row);

  const last = await getSyncState("trades_last_block", null);
  const lastNum = last ? Number(last) : 0;
  if (log.blockNumber > lastNum) await upsertSyncState("trades_last_block", log.blockNumber);
}

// Periodically mark pending trades confirmed after N blocks.
async function confirmLoop() {
  while (true) {
    try {
      if (!provider) {
        await sleep(2000);
        continue;
      }
      const latest = await provider.getBlockNumber();
      const cutoff = latest - CONFIRMATIONS;
      if (cutoff > 0) {
        const { data, error } = await supabase
          .from("trades")
          .select("tx_hash,block_number")
          .eq("status", "pending")
          .lte("block_number", cutoff)
          .limit(500);
        if (error) throw error;

        for (const r of data || []) {
          await markConfirmed(r.tx_hash);
        }
      }
    } catch (e) {
      log.error("confirm loop error", e?.message || e);
    }
    await sleep(5000);
  }
}

// Establish websocket provider, backfill missed range, and subscribe for live swaps with reconnects.
async function connect() {
  if (connecting) return;
  connecting = true;
  try {
    provider = new ethers.WebSocketProvider(WSS_RPC_URL);

    provider.on("error", (err) => log.error("provider error", err?.message || err));
    provider.websocket?.on?.("close", async (code) => {
      log.error(`websocket closed (${code ?? "unknown"}); attempting reconnect`);
      try {
        provider?.destroy?.();
      } catch (_) {}
      provider = null;
      await sleep(3000);
      connecting = false;
      connect().catch((e) => log.error("reconnect error", e?.message || e));
    });

    const latest = await provider.getBlockNumber();
    const last = await getSyncState("trades_last_block", null);
    const start = last ? Number(last) + 1 : Math.max(latest - 5000, 0);

    if (start <= latest - 1) {
      await backfill(start, latest - 1);
    }

    provider.on(getFilter(), async (logItem) => {
      try {
        await handleLog(logItem, false);
      } catch (e) {
        log.error("log handler error", e?.message || e);
      }
    });
  } catch (e) {
    log.error("connect error", e?.message || e);
    provider = null;
    await sleep(5000);
    connect().catch((err) => log.error("reconnect error", err?.message || err));
  } finally {
    connecting = false;
  }
}

connect()
  .then(() => confirmLoop().catch((e) => log.error("confirm loop crash", e?.message || e)))
  .catch((e) => {
    log.error(e?.message || e);
    process.exit(1);
  });
