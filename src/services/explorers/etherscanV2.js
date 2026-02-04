// Generic Etherscan v2-style API helpers (used by BaseScan).

import { AppError } from "../../lib/errors.js";
import { fetchJson } from "../../lib/http.js";

const RETRY_DELAYS = [250, 750, 1750];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const isRateLimit = (status, message) => {
  if (status === 429) return true;
  if (message && /rate limit/i.test(message)) return true;
  return false;
};

/**
 * Build an Etherscan v2 API URL.
 * @param {{ baseUrl: string, chainId: string|number, module: string, action: string, apiKey?: string, params?: Record<string, string|number> }} options
 */
export function buildEtherscanV2Url(options) {
  const { baseUrl, chainId, module, action, apiKey = "", params = {} } = options;
  const search = new URLSearchParams({
    chainid: String(chainId),
    module,
    action,
    apikey: apiKey
  });

  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null) return;
    search.set(key, String(value));
  });

  return `${baseUrl}?${search.toString()}`;
}

/**
 * Extract a best-effort error message from an Etherscan v2 response.
 * @param {any} json
 */
export function extractEtherscanV2Error(json) {
  const msg = json?.message || json?.result || "etherscan error";
  return typeof msg === "string" ? msg : JSON.stringify(msg);
}

/**
 * Fetch JSON from an Etherscan v2 endpoint with retry on rate limits.
 * @param {string} url
 * @param {{ retries?: number[], label?: string, timeoutMs?: number }} [options]
 */
export async function fetchEtherscanV2Json(url, options = {}) {
  const delays = Array.isArray(options.retries) && options.retries.length ? options.retries : RETRY_DELAYS;
  const label = options.label || "etherscan";
  const timeoutMs = options.timeoutMs;
  let lastError = null;

  for (let i = 0; i < delays.length; i += 1) {
    const { ok, status, json, text } = await fetchJson(url, { timeoutMs });
    if (ok && json?.status === "1") return json;

    const message = json ? extractEtherscanV2Error(json) : (text || "etherscan error");
    const rateLimited = isRateLimit(status, message);
    lastError = new AppError(`${label} http ${status}: ${message}`, { status: status || 500, code: "ETHERSCAN_HTTP" });

    if (rateLimited && i < delays.length - 1) {
      await sleep(delays[i]);
      continue;
    }
    throw lastError;
  }

  throw lastError || new AppError(`${label} error`, { status: 500, code: "ETHERSCAN_HTTP" });
}

/**
 * Create a small helper client for Etherscan v2 endpoints.
 * @param {{ baseUrl: string, chainId: string|number, apiKey?: string, label?: string, timeoutMs?: number }} options
 */
export function createEtherscanV2Client(options) {
  const { baseUrl, chainId, apiKey = "", label = "etherscan", timeoutMs } = options;

  return {
    buildUrl: (module, action, params = {}, keyOverride = apiKey) =>
      buildEtherscanV2Url({ baseUrl, chainId, module, action, apiKey: keyOverride, params }),
    request: (module, action, params = {}, keyOverride = apiKey) =>
      fetchEtherscanV2Json(buildEtherscanV2Url({ baseUrl, chainId, module, action, apiKey: keyOverride, params }), {
        label,
        timeoutMs
      })
  };
}
