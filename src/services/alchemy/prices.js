// Alchemy pricing API helpers for current and historical prices.

import { config } from "../../config/env.js";
import { AppError } from "../../lib/errors.js";
import { fetchJson } from "../../lib/http.js";

const getRangeConfig = (range) => {
  const endTime = new Date();
  const r = (range || "24h").toLowerCase();
  if (r === "4h") {
    return { startTime: new Date(endTime.getTime() - 4 * 60 * 60 * 1000), endTime, sampleCount: 48 };
  }
  if (r === "7d") {
    return { startTime: new Date(endTime.getTime() - 7 * 24 * 60 * 60 * 1000), endTime, sampleCount: 168 };
  }
  if (r === "30d") {
    return { startTime: new Date(endTime.getTime() - 30 * 24 * 60 * 60 * 1000), endTime, sampleCount: 180 };
  }
  return { startTime: new Date(endTime.getTime() - 24 * 60 * 60 * 1000), endTime, sampleCount: 96 };
};

const normalizeHistoryArray = (arr) => {
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
};

/**
 * Fetch current and historical price for a token address.
 * @param {string} tokenAddress
 * @param {{ range?: string }} [options]
 */
export async function getAlchemyPrice(tokenAddress, { range = "24h" } = {}) {
  if (!config.alchemy.priceKey) {
    throw new AppError("ALCHEMY_BASE_API_KEY missing", { status: 500, code: "ENV_MISSING" });
  }

  const priceUrl = `https://api.g.alchemy.com/prices/v1/${config.alchemy.priceKey}/tokens/by-address`;
  const historyUrl = `https://api.g.alchemy.com/prices/v1/${config.alchemy.priceKey}/tokens/historical`;

  const { startTime, endTime, sampleCount } = getRangeConfig(range);

  const priceRes = await fetchJson(priceUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      addresses: [{ network: "base-mainnet", address: tokenAddress }]
    })
  });

  if (!priceRes.ok) {
    throw new AppError(`Alchemy price http ${priceRes.status}: ${priceRes.text || "no body"}`, {
      status: priceRes.status || 500,
      code: "ALCHEMY_PRICE"
    });
  }

  const priceJson = priceRes.text ? JSON.parse(priceRes.text || "{}") : priceRes.json || {};
  const priceEntry = priceJson?.data?.[0] || priceJson?.[0];
  const priceVal = priceEntry?.prices?.[0]?.value ?? priceEntry?.price?.value ?? priceEntry?.price ?? null;
  const priceNum = Number(priceVal);
  if (!Number.isFinite(priceNum)) throw new AppError("Alchemy price missing", { status: 500, code: "ALCHEMY_PRICE" });

  const historyRes = await fetchJson(historyUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      address: tokenAddress,
      network: "base-mainnet",
      startTime: startTime.toISOString(),
      endTime: endTime.toISOString(),
      sampleCount
    })
  });

  if (!historyRes.ok) {
    throw new AppError(`Alchemy history http ${historyRes.status}: ${historyRes.text || "no body"}`, {
      status: historyRes.status || 500,
      code: "ALCHEMY_HISTORY"
    });
  }

  const historyJson = historyRes.text ? JSON.parse(historyRes.text || "{}") : historyRes.json || {};
  const historyData = Array.isArray(historyJson?.data) ? historyJson.data[0] : historyJson?.data?.[0] || historyJson?.data || null;
  const rawHistory = historyData?.prices || historyData?.priceHistory || historyData?.history || historyJson?.prices || null;
  const history = normalizeHistoryArray(rawHistory);

  return { price: priceNum, history };
}
