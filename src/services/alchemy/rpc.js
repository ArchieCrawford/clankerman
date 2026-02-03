// Alchemy JSON-RPC helpers with retry logic.

import { AppError, normalizeError } from "../../lib/errors.js";
import { fetchJson } from "../../lib/http.js";

const RETRY_DELAYS = [250, 750, 1750];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const isRetryable = (status, message) => {
  if (status === 429) return true;
  if (status >= 500) return true;
  if (message && /rate limit/i.test(message)) return true;
  return false;
};

/**
 * Perform a JSON-RPC call with retries on 429/5xx.
 * @param {string} url
 * @param {string} method
 * @param {unknown[]} params
 * @param {{ retries?: number[] }} [options]
 */
export async function jsonRpcCall(url, method, params, options = {}) {
  const delays = Array.isArray(options.retries) && options.retries.length ? options.retries : RETRY_DELAYS;
  let lastError = null;

  for (let i = 0; i < delays.length; i += 1) {
    try {
      const payload = { jsonrpc: "2.0", id: 1, method, params };
      const { ok, status, json, text } = await fetchJson(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload)
      });

      if (!ok) {
        const message = text || json?.error?.message || `rpc http ${status}`;
        const retryable = isRetryable(status, message);
        if (retryable && i < delays.length - 1) {
          await sleep(delays[i]);
          continue;
        }
        throw new AppError(message, { status: status || 500, code: "RPC_HTTP" });
      }

      if (json?.error) {
        const message = json.error.message || "rpc error";
        const retryable = isRetryable(status, message);
        if (retryable && i < delays.length - 1) {
          await sleep(delays[i]);
          continue;
        }
        throw new AppError(message, { status: status || 500, code: "RPC_ERROR" });
      }

      return json?.result;
    } catch (err) {
      lastError = err;
      const normalized = normalizeError(err);
      if (i < delays.length - 1 && isRetryable(normalized.status, normalized.message)) {
        await sleep(delays[i]);
        continue;
      }
      if (err instanceof AppError) throw err;
      throw new AppError(normalized.message, {
        status: normalized.status || 500,
        code: normalized.code || "RPC_ERROR",
        cause: err
      });
    }
  }

  throw lastError || new AppError("rpc error", { status: 500, code: "RPC_ERROR" });
}

const padAddress = (addr) => addr.toLowerCase().replace(/^0x/, "").padStart(64, "0");

/**
 * Fetch native balance over RPC.
 * @param {string} rpcUrl
 * @param {string} address
 */
export async function getNativeBalanceRpc(rpcUrl, address) {
  const result = await jsonRpcCall(rpcUrl, "eth_getBalance", [address, "latest"]);
  return BigInt(result || "0").toString();
}

/**
 * Fetch ERC20 token balance over RPC.
 * @param {string} rpcUrl
 * @param {string} token
 * @param {string} address
 */
export async function getTokenBalanceRpc(rpcUrl, token, address) {
  const data = `0x70a08231${padAddress(address)}`;
  const result = await jsonRpcCall(rpcUrl, "eth_call", [{ to: token, data }, "latest"]);
  return BigInt(result || "0").toString();
}

/**
 * Fetch ERC20 decimals over RPC.
 * @param {string} rpcUrl
 * @param {string} token
 */
export async function getTokenDecimalsRpc(rpcUrl, token) {
  const data = "0x313ce567";
  const result = await jsonRpcCall(rpcUrl, "eth_call", [{ to: token, data }, "latest"]);
  if (!result) return null;
  try {
    return Number(BigInt(result));
  } catch (_) {
    return null;
  }
}
