// Centralized environment configuration and validation.

import { AppError } from "../lib/errors.js";
import { optionalEnv, toInt, toLowerAddress } from "../lib/validate.js";

const CLANKER_DEFAULT = "0x1bc0c42215582d5a085795f4badbac3ff36d1bcb";
const WETH_DEFAULT = "0x4200000000000000000000000000000000000006";
const USDC_DEFAULT = "0x833589fcd6edb6e08f4c7c32d4f71b54b5b0e4d";
const POOL_DEFAULT = "0xdf43c40188c1a711bc49fa5922198b8d73291800";

const isHttpUrl = (value) => /^https?:\/\//i.test(String(value || ""));
const pickHttpUrl = (value) => (isHttpUrl(value) ? String(value).trim() : "");

const alchemyBaseApiKey = optionalEnv("ALCHEMY_BASE_API_KEY", "") || optionalEnv("ALCHEMY_API_KEY", "");
const alchemyPriceApiKey = optionalEnv("ALCHEMY_PRICE_API_KEY", "") || optionalEnv("ALCHEMY_API_KEY", "");
const explicitAlchemyBaseUrl = pickHttpUrl(optionalEnv("ALCHEMY_BASE_URL", ""));
const derivedAlchemyBaseUrl =
  alchemyBaseApiKey || alchemyPriceApiKey
    ? `https://base-mainnet.g.alchemy.com/v2/${alchemyBaseApiKey || alchemyPriceApiKey}`
    : "";
const fallbackRpcUrl =
  pickHttpUrl(optionalEnv("BASE_RPC_URL", "")) ||
  pickHttpUrl(optionalEnv("RPC_URL", "")) ||
  pickHttpUrl(optionalEnv("NEXT_PUBLIC_BASE_RPC", ""));
const resolvedRpcUrl = explicitAlchemyBaseUrl || derivedAlchemyBaseUrl || fallbackRpcUrl;

export const config = {
  supabase: {
    url: optionalEnv("SUPABASE_URL", ""),
    serviceRoleKey: optionalEnv("SUPABASE_SERVICE_ROLE_KEY", ""),
    anonKey: optionalEnv("SUPABASE_ANON_KEY", "")
  },
  chain: {
    name: optionalEnv("CHAIN", "base"),
    confirmations: toInt(optionalEnv("CONFIRMATIONS", "10"), 10),
    logChunk: toInt(optionalEnv("LOG_CHUNK", "8"), 8),
    baseChainId: optionalEnv("BASE_CHAIN_ID", "8453")
  },
  tokens: {
    clanker: toLowerAddress(optionalEnv("CLANKER_TOKEN", CLANKER_DEFAULT)),
    weth: toLowerAddress(optionalEnv("WETH_TOKEN", WETH_DEFAULT)),
    usdc: toLowerAddress(optionalEnv("USDC_TOKEN", USDC_DEFAULT)),
    bnkr: toLowerAddress(optionalEnv("BNKR_ADDRESS", "")),
    treasury: toLowerAddress(optionalEnv("TREASURY_ADDRESS", "")),
    buyback: toLowerAddress(optionalEnv("BUYBACK_ADDRESS", "")),
    feeAccum: toLowerAddress(optionalEnv("FEE_ACCUM_ADDRESS", ""))
  },
  alchemy: {
    baseUrl: resolvedRpcUrl,
    baseApiKey: alchemyBaseApiKey,
    priceApiKey: alchemyPriceApiKey,
    priceKey: alchemyBaseApiKey || alchemyPriceApiKey,
    wssRpcUrl: optionalEnv("WSS_RPC_URL", ""),
    webhookSigningKey: optionalEnv("ALCHEMY_WEBHOOK_SIGNING_KEY", ""),
    webhookToken: optionalEnv("ALCHEMY_WEBHOOK_TOKEN", "")
  },
  explorers: {
    basescanApiKey: optionalEnv("BASESCAN_API_KEY", ""),
    basescanApiBase: optionalEnv("BASESCAN_API_BASE", "https://api.etherscan.io/v2/api")
  },
  pools: {
    addresses: optionalEnv("POOL_ADDRESSES", "")
      .split(",")
      .map((addr) => addr.trim())
      .filter(Boolean),
    swapTopic: optionalEnv("SWAP_TOPIC", "").trim().toLowerCase(),
    clankerUsdcV3Pool: toLowerAddress(optionalEnv("CLANKER_USDC_V3_POOL", POOL_DEFAULT))
  },
  pricing: {
    cmcApiKey: optionalEnv("CMC_API_KEY", "")
  },
  health: {
    baseUrl: optionalEnv("HEALTHCHECK_BASE_URL", "")
  }
};

/**
 * Validate listener/server environment requirements.
 */
export function strictServer() {
  if (!config.alchemy.wssRpcUrl) {
    throw new AppError("Missing WSS_RPC_URL", { status: 500, code: "ENV_MISSING" });
  }
  if (!config.supabase.url) {
    throw new AppError("Missing SUPABASE_URL", { status: 500, code: "ENV_MISSING" });
  }
  if (!config.supabase.serviceRoleKey) {
    throw new AppError("Missing SUPABASE_SERVICE_ROLE_KEY", { status: 500, code: "ENV_MISSING" });
  }
  if (!config.pools.addresses.length) {
    throw new AppError("Missing POOL_ADDRESSES", { status: 500, code: "ENV_MISSING" });
  }
  if (!config.pools.swapTopic.startsWith("0x")) {
    throw new AppError("Missing/invalid SWAP_TOPIC", { status: 500, code: "ENV_MISSING" });
  }
  return config;
}

/**
 * Validate API environment requirements with fallback-aware rules.
 * @param {{ requireSupabase?: boolean, requireBalancesProvider?: boolean, requireAlchemyPriceKey?: boolean }} [options]
 */
export function strictApi(options = {}) {
  const { requireSupabase = false, requireBalancesProvider = false, requireAlchemyPriceKey = false } = options;

  if (requireSupabase && (!config.supabase.url || !config.supabase.serviceRoleKey)) {
    throw new AppError("Supabase env missing", { status: 500, code: "ENV_MISSING" });
  }

  if (requireBalancesProvider && !config.explorers.basescanApiKey && !config.alchemy.baseUrl) {
    throw new AppError("No balance provider (BASESCAN_API_KEY or ALCHEMY_BASE_URL)", {
      status: 500,
      code: "ENV_MISSING"
    });
  }

  if (requireAlchemyPriceKey && !config.alchemy.priceKey) {
    throw new AppError("ALCHEMY_BASE_API_KEY missing", { status: 500, code: "ENV_MISSING" });
  }

  return config;
}
