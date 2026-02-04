// API handler for token pricing.

import { ethers } from "ethers";
import { config } from "../config/env.js";
import { createLogger } from "../lib/logger.js";
import { normalizeError } from "../lib/errors.js";
import { getRequestId } from "../lib/http.js";
import { getAlchemyPrice } from "../services/alchemy/prices.js";

const logger = createLogger("api:price");

const V3_POOL_ABI = [
  "function slot0() view returns (uint160,int24,uint16,uint16,uint16,uint8,bool)",
  "function token0() view returns (address)",
  "function token1() view returns (address)"
];

const Q192 = BigInt(2) ** BigInt(192);

const computePrice = (sqrtPriceX96) => {
  const priceX192 = sqrtPriceX96 * sqrtPriceX96;
  return Number(priceX192) / Number(Q192);
};

/**
 * Vercel handler for prices.
 * @param {import('http').IncomingMessage & { query?: any, headers?: any }} req
 * @param {import('http').ServerResponse & { json?: Function, status?: Function }} res
 */
export default async function priceHandler(req, res) {
  const requestId = getRequestId(req);
  res.setHeader("Cache-Control", "no-store");

  const sendError = (status, message) => {
    logger.error("request error", { requestId, status, message });
    return res.status(status).json({ error: message, requestId });
  };

  try {
    const rpcUrl = config.alchemy.baseUrl;
    const poolAddress = config.pools.clankerUsdcV3Pool;
    const clankerToken = config.tokens.clanker;
    const wethToken = config.tokens.weth;
    const usdcToken = config.tokens.usdc;
    const range = (req.query?.range || "24h").toLowerCase();

    const requested = (req.query?.token || req.query?.address || "").toLowerCase();
    const targetAddr = requested === "bnkr"
      ? config.tokens.bnkr
      : requested === "weth"
      ? wethToken
      : requested === "usdc"
      ? usdcToken
      : (requested || clankerToken);

    if (!targetAddr) return sendError(400, "token address missing");
    if (requested === "bnkr" && !config.tokens.bnkr) {
      return sendError(400, "BNKR_ADDRESS not set");
    }

    try {
      const alch = await getAlchemyPrice(targetAddr, { range });
      if (alch?.price) {
        return res.json({ price: alch.price, history: alch.history || null, source: "alchemy" });
      }
    } catch (err) {
      const normalized = normalizeError(err, { message: "price error" });
      if (targetAddr !== clankerToken) {
        if (targetAddr === usdcToken) {
          return res.json({ price: 1, history: null, source: "static" });
        }
        return sendError(500, normalized.message || "price error");
      }
      logger.debug("alchemy price fallback", { requestId, message: normalized.message });
    }

    if (!rpcUrl) return sendError(500, "ALCHEMY_BASE_URL missing");

    if (targetAddr !== clankerToken) {
      return sendError(500, "No pool price for requested token");
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

    return res.json({ price, history: null, source: "pool" });
  } catch (err) {
    const normalized = normalizeError(err);
    return sendError(normalized.status || 500, normalized.message || "error");
  }
}
