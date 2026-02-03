// Swap log parsing, pool metadata caching, and amount formatting helpers.

import { ethers } from "ethers";

export const V3_SWAP_TOPIC = "0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67";
export const V2_SWAP_TOPIC = "0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822";

const I_PAIR = ["function token0() view returns (address)", "function token1() view returns (address)"];
const I_ERC20 = ["function symbol() view returns (string)", "function decimals() view returns (uint8)"];

const V2_IFACE = new ethers.Interface([
  "event Swap(address indexed sender,uint amount0In,uint amount1In,uint amount0Out,uint amount1Out,address indexed to)"
]);

const V3_IFACE = new ethers.Interface([
  "event Swap(address indexed sender,address indexed recipient,int256 amount0,int256 amount1,uint160 sqrtPriceX96,uint128 liquidity,int24 tick)"
]);

/**
 * Create a pool metadata cache for token symbol/decimals lookup.
 * @param {{ logger?: ReturnType<import('../lib/logger.js').createLogger> }} [options]
 */
export function createPoolMetaCache(options = {}) {
  const { logger } = options;
  const poolMeta = new Map();
  const erc20Meta = new Map();

  const getErc20Meta = async (addr, provider) => {
    const key = addr.toLowerCase();
    if (erc20Meta.has(key)) return erc20Meta.get(key);
    const contract = new ethers.Contract(addr, I_ERC20, provider);
    let symbol = "";
    let decimals = 18;
    try {
      symbol = await contract.symbol();
    } catch (err) {
      if (logger?.debug) logger.debug("erc20 symbol error", err?.message || err);
      symbol = "";
    }
    try {
      decimals = Number(await contract.decimals());
    } catch (err) {
      if (logger?.debug) logger.debug("erc20 decimals error", err?.message || err);
      decimals = 18;
    }
    const meta = { symbol, decimals };
    erc20Meta.set(key, meta);
    return meta;
  };

  const getPoolMeta = async (pool, provider) => {
    const key = pool.toLowerCase();
    if (poolMeta.has(key)) return poolMeta.get(key);
    const contract = new ethers.Contract(pool, I_PAIR, provider);
    const token0 = await contract.token0();
    const token1 = await contract.token1();
    const [m0, m1] = await Promise.all([getErc20Meta(token0, provider), getErc20Meta(token1, provider)]);
    const meta = {
      token0: token0.toLowerCase(),
      token1: token1.toLowerCase(),
      token0Symbol: m0.symbol,
      token1Symbol: m1.symbol,
      token0Decimals: m0.decimals,
      token1Decimals: m1.decimals
    };
    poolMeta.set(key, meta);
    return meta;
  };

  return { getPoolMeta };
}

/**
 * Parse a swap log into a normalized object.
 * @param {import('ethers').Log} log
 */
export function parseSwapLog(log) {
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

/**
 * Format bigint amounts into decimals, falling back to raw.
 * @param {string|bigint} raw
 * @param {number} decimals
 */
export function formatAmount(raw, decimals) {
  try {
    return ethers.formatUnits(raw, decimals);
  } catch (_) {
    return raw;
  }
}

/**
 * Determine side and amounts vs the clanker token.
 * @param {object} meta
 * @param {object} swap
 * @param {string} clankerToken
 */
export function deriveSideAndAmounts(meta, swap, clankerToken) {
  const isClanker0 = meta.token0 === clankerToken;
  const isClanker1 = meta.token1 === clankerToken;
  if (!isClanker0 && !isClanker1) {
    return { side: "unknown", clanker_amount: null, quote_symbol: null, quote_amount: null };
  }

  if (swap.kind === "v3") {
    const clDelta = BigInt(isClanker0 ? swap.amount0 : swap.amount1);
    const quoteDelta = BigInt(isClanker0 ? swap.amount1 : swap.amount0);
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
