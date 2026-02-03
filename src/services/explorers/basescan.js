// BaseScan balance helpers with RPC fallback.

import { config } from "../../config/env.js";
import { AppError, normalizeError } from "../../lib/errors.js";
import { createEtherscanV2Client } from "./etherscanV2.js";
import { getNativeBalanceRpc, getTokenBalanceRpc, getTokenDecimalsRpc } from "../alchemy/rpc.js";

/**
 * Fetch native balance via BaseScan or RPC fallback.
 * @param {string} address
 * @param {{ apiKey?: string, baseUrl?: string, chainId?: string|number, rpcUrl?: string, logger?: ReturnType<import('../../lib/logger.js').createLogger> }} [options]
 */
export async function getNativeBalance(address, options = {}) {
  const apiKey = options.apiKey ?? config.explorers.basescanApiKey;
  const baseUrl = options.baseUrl ?? config.explorers.basescanApiBase;
  const chainId = options.chainId ?? config.chain.baseChainId;
  const rpcUrl = options.rpcUrl ?? config.alchemy.baseUrl;

  if (apiKey) {
    const client = createEtherscanV2Client({ baseUrl, chainId, apiKey, label: "basescan" });
    const json = await client.request("account", "balance", { address, tag: "latest" });
    return json.result;
  }

  if (rpcUrl) {
    return getNativeBalanceRpc(rpcUrl, address);
  }

  throw new AppError("No balance provider (BASESCAN_API_KEY or ALCHEMY_BASE_URL)", {
    status: 500,
    code: "ENV_MISSING"
  });
}

/**
 * Fetch token balance via BaseScan or RPC fallback.
 * @param {string} token
 * @param {string} address
 * @param {{ apiKey?: string, baseUrl?: string, chainId?: string|number, rpcUrl?: string }} [options]
 */
export async function getTokenBalance(token, address, options = {}) {
  const apiKey = options.apiKey ?? config.explorers.basescanApiKey;
  const baseUrl = options.baseUrl ?? config.explorers.basescanApiBase;
  const chainId = options.chainId ?? config.chain.baseChainId;
  const rpcUrl = options.rpcUrl ?? config.alchemy.baseUrl;

  if (apiKey) {
    const client = createEtherscanV2Client({ baseUrl, chainId, apiKey, label: "basescan" });
    const json = await client.request("account", "tokenbalance", {
      contractaddress: token,
      address,
      tag: "latest"
    });
    return json.result;
  }

  if (rpcUrl) {
    return getTokenBalanceRpc(rpcUrl, token, address);
  }

  throw new AppError("No balance provider (BASESCAN_API_KEY or ALCHEMY_BASE_URL)", {
    status: 500,
    code: "ENV_MISSING"
  });
}

/**
 * Fetch token decimals from BaseScan tokeninfo endpoint.
 * @param {string} contract
 * @param {{ apiKey?: string, baseUrl?: string, chainId?: string|number }} [options]
 */
export async function getTokenInfoDecimals(contract, options = {}) {
  const apiKey = options.apiKey ?? config.explorers.basescanApiKey;
  const baseUrl = options.baseUrl ?? config.explorers.basescanApiBase;
  const chainId = options.chainId ?? config.chain.baseChainId;

  if (!apiKey) return null;

  const client = createEtherscanV2Client({ baseUrl, chainId, apiKey, label: "basescan" });
  const json = await client.request("token", "tokeninfo", { contractaddress: contract });
  const first = Array.isArray(json.result) ? json.result[0] : null;
  const div = first?.divisor ?? first?.TokenDivisor ?? first?.tokenDivisor;
  const dec = div != null ? Number(div) : null;
  if (!Number.isFinite(dec)) return null;
  if (dec < 0 || dec > 36) return null;
  return dec;
}

/**
 * Resolve token decimals with RPC fallback.
 * @param {string} contract
 * @param {{ apiKey?: string, baseUrl?: string, chainId?: string|number, rpcUrl?: string }} [options]
 */
export async function resolveTokenDecimals(contract, options = {}) {
  const apiKey = options.apiKey ?? config.explorers.basescanApiKey;
  const rpcUrl = options.rpcUrl ?? config.alchemy.baseUrl;

  let decimals = null;
  if (apiKey) {
    try {
      decimals = await getTokenInfoDecimals(contract, options);
    } catch (err) {
      const normalized = normalizeError(err);
      if (options.logger?.debug) options.logger.debug("tokeninfo decimals error", normalized.message);
      decimals = null;
    }
  }

  if (!Number.isFinite(decimals) && rpcUrl) {
    try {
      decimals = await getTokenDecimalsRpc(rpcUrl, contract);
    } catch (err) {
      const normalized = normalizeError(err);
      if (options.logger?.debug) options.logger.debug("rpc decimals error", normalized.message);
      decimals = null;
    }
  }

  return Number.isFinite(decimals) ? decimals : null;
}
