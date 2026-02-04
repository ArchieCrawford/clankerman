// Coingecko pricing fallback helpers.

import { fetchJson } from "../../lib/http.js";
import { AppError } from "../../lib/errors.js";

const COINGECKO_BASE = "https://api.coingecko.com/api/v3";

/**
 * Fetch ETH/USD price from Coingecko.
 */
export async function getCoingeckoEthPrice() {
  const url = `${COINGECKO_BASE}/simple/price?ids=ethereum&vs_currencies=usd`;
  const { ok, status, json } = await fetchJson(url, { timeoutMs: 10000 });
  if (!ok) {
    throw new AppError(`coingecko http ${status}`, { status: status || 500, code: "COINGECKO_HTTP" });
  }
  const price = Number(json?.ethereum?.usd);
  if (!Number.isFinite(price)) {
    throw new AppError("coingecko price missing", { status: 500, code: "COINGECKO_PARSE" });
  }
  return price;
}
