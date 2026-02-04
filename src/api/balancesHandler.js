// API handler for treasury and token balances.

import { config } from "../config/env.js";
import { createLogger } from "../lib/logger.js";
import { normalizeError } from "../lib/errors.js";
import { getRequestId } from "../lib/http.js";
import { isAddress } from "../lib/validate.js";
import { getNativeBalance, getTokenBalance, resolveTokenDecimals } from "../services/explorers/basescan.js";

const logger = createLogger("api:balances");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const formatBalance = (raw, decimals) => {
  const big = BigInt(raw || "0");
  const denom = BigInt(10) ** BigInt(decimals);
  const whole = big / denom;
  const frac = big % denom;
  const fracStr = frac.toString().padStart(decimals, "0").replace(/0+$/, "");
  return fracStr ? `${whole}.${fracStr}` : whole.toString();
};

/**
 * Vercel handler for balances.
 * @param {import('http').IncomingMessage & { query?: any, headers?: any }} req
 * @param {import('http').ServerResponse & { json?: Function, status?: Function }} res
 */
export default async function balancesHandler(req, res) {
  const requestId = getRequestId(req);
  res.setHeader("Cache-Control", "no-store");

  const sendError = (status, message) => {
    logger.error("request error", { requestId, status, message });
    return res.status(status).json({ error: message, requestId });
  };

  try {
    const address = (req.query?.address || config.tokens.treasury || "").trim();
    if (!address) return sendError(400, "address is required");
    if (!isAddress(address)) return sendError(400, "invalid address");

    const apiKey = config.explorers.basescanApiKey;
    const rpcUrl = config.alchemy.baseUrl;
    if (!apiKey && !rpcUrl) {
      return sendError(500, "No balance provider (BASESCAN_API_KEY or ALCHEMY_BASE_URL)");
    }

    const tokenMeta = [
      { symbol: "CLANKER", address: config.tokens.clanker, decimals: 18 },
      { symbol: "WETH", address: config.tokens.weth, decimals: 18 },
      { symbol: "USDC", address: config.tokens.usdc, decimals: 6 }
    ];

    const filterSymbols = (req.query?.symbols || "")
      .split(",")
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);

    const tokens = filterSymbols.length
      ? tokenMeta.filter((t) => filterSymbols.includes(t.symbol))
      : tokenMeta;

    const timeoutMs = 3000;
    const nativeRaw = await getNativeBalance(address.toLowerCase(), { apiKey, rpcUrl, timeoutMs });

    const tokenBalances = await Promise.all(
      tokens.map((token, idx) => (async () => {
        await sleep(80 * idx);
        try {
          const raw = await getTokenBalance(token.address, address.toLowerCase(), { apiKey, rpcUrl, timeoutMs });
          let decimals = token.decimals;
          if (!Number.isFinite(decimals)) {
            const resolved = await resolveTokenDecimals(token.address, { apiKey, rpcUrl, logger, timeoutMs });
            if (Number.isFinite(resolved)) decimals = resolved;
          }
          if (!Number.isFinite(decimals)) decimals = 18;

          return {
            symbol: token.symbol,
            address: token.address,
            decimals,
            balanceRaw: raw,
            balance: formatBalance(raw, decimals)
          };
        } catch (err) {
          const normalized = normalizeError(err);
          logger.debug("token balance error", { requestId, symbol: token.symbol, message: normalized.message });
          return {
            symbol: token.symbol,
            address: token.address,
            decimals: token.decimals,
            error: normalized.message || "error"
          };
        }
      })())
    );

    return res.status(200).json({
      address,
      native: {
        balanceRaw: nativeRaw,
        balance: formatBalance(nativeRaw, 18),
        decimals: 18
      },
      tokens: tokenBalances
    });
  } catch (err) {
    const normalized = normalizeError(err);
    return sendError(normalized.status || 500, normalized.message || "error");
  }
}
