// CoinMarketCap pricing helpers.

import { config } from "../../config/env.js";
import { AppError } from "../../lib/errors.js";
import { fetchJson } from "../../lib/http.js";

const CMC_BASE = "https://pro-api.coinmarketcap.com/v1/cryptocurrency/quotes/latest";

/**
 * Fetch USD price for a symbol from CoinMarketCap.
 * @param {string} symbol
 * @param {{ convert?: string }} [options]
 */
export async function getCoinMarketCapPrice(symbol, options = {}) {
  const apiKey = config.pricing?.cmcApiKey || "";
  if (!apiKey) {
    throw new AppError("CMC_API_KEY missing", { status: 500, code: "ENV_MISSING" });
  }

  const symbolKey = String(symbol || "").trim().toUpperCase();
  if (!symbolKey) {
    throw new AppError("coinmarketcap symbol missing", { status: 400, code: "CMC_SYMBOL" });
  }

  const convert = options.convert || "USD";
  const params = new URLSearchParams({
    symbol: symbolKey,
    convert
  });

  const url = `${CMC_BASE}?${params.toString()}`;
  const { ok, status, json, text } = await fetchJson(url, {
    headers: {
      Accept: "application/json",
      "X-CMC_PRO_API_KEY": apiKey
    },
    timeoutMs: 10000
  });

  if (!ok) {
    throw new AppError(`coinmarketcap http ${status}: ${text || "no body"}`, {
      status: status || 500,
      code: "CMC_HTTP"
    });
  }

  const entry = json?.data?.[symbolKey];
  const price = Number(entry?.quote?.[convert]?.price);
  if (!Number.isFinite(price)) {
    throw new AppError("coinmarketcap price missing", { status: 500, code: "CMC_PARSE" });
  }

  return price;
}
