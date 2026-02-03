// Listener entrypoint for swap tracking and Supabase persistence.

import "dotenv/config";
import { ethers } from "ethers";
import { config, strictServer } from "./src/config/env.js";
import { createLogger } from "./src/lib/logger.js";
import { normalizeError } from "./src/lib/errors.js";
import { createAlchemySocketManager } from "./src/services/alchemy/sockets.js";
import { runEndpointHealthChecks } from "./src/services/health/endpointChecks.js";
import { createPoolMetaCache, parseSwapLog, deriveSideAndAmounts } from "./src/services/swaps.js";
import { getSyncState, upsertSyncState } from "./src/services/supabase/syncState.js";
import { insertTrade, markConfirmed } from "./src/services/supabase/trades.js";
import { getSupabaseAdminClient } from "./src/services/supabase/client.js";

const logger = createLogger("listener");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

strictServer();

const CHAIN = config.chain.name;
const CONFIRMATIONS = config.chain.confirmations;
const CLANKER_TOKEN = config.tokens.clanker;
const LOG_CHUNK = config.chain.logChunk;

const POOL_ADDRESSES = config.pools.addresses
  .map((addr) => addr.trim())
  .filter(Boolean)
  .map((addr) => {
    try {
      return ethers.getAddress(addr);
    } catch (err) {
      logger.warn(`Invalid pool address skipped: ${addr}`);
      return null;
    }
  })
  .filter(Boolean);

const SWAP_TOPIC = config.pools.swapTopic;

const poolMetaCache = createPoolMetaCache({ logger });

const getFilter = () => ({
  address: POOL_ADDRESSES,
  topics: [SWAP_TOPIC]
});

const backfill = async (provider, fromBlock, toBlock) => {
  logger.info(`Backfill start ${fromBlock} -> ${toBlock}`);
  let total = 0;
  let cursor = fromBlock;
  while (cursor <= toBlock) {
    const end = Math.min(cursor + LOG_CHUNK - 1, toBlock);
    try {
      const logs = await provider.getLogs({
        ...getFilter(),
        fromBlock: cursor,
        toBlock: end
      });
      total += logs.length;
      for (const logItem of logs) {
        try {
          await handleLog(logItem, provider, true);
        } catch (err) {
          const normalized = normalizeError(err);
          logger.error("backfill log error", normalized.message);
        }
      }
    } catch (err) {
      const normalized = normalizeError(err);
      logger.error("backfill chunk error", `range ${cursor}-${end}`, normalized.message);
    }
    cursor = end + 1;
    await sleep(150);
  }
  logger.info(`Backfill done (${total} logs)`);
};

const handleLog = async (logItem, provider, isBackfill = false) => {
  let meta;
  try {
    meta = await poolMetaCache.getPoolMeta(logItem.address, provider);
  } catch (err) {
    const normalized = normalizeError(err);
    logger.warn("pool meta error", logItem.address, normalized.message);
    return;
  }

  const block = await provider.getBlock(logItem.blockNumber);
  const txHash = logItem.transactionHash;
  const swap = parseSwapLog(logItem);
  const derived = deriveSideAndAmounts(meta, swap, CLANKER_TOKEN);

  const row = {
    chain: CHAIN,
    tx_hash: txHash,
    block_number: logItem.blockNumber,
    block_time: new Date(block.timestamp * 1000).toISOString(),
    pool_address: (logItem.address || "").toLowerCase(),
    side: derived.side,
    clanker_amount: derived.clanker_amount,
    quote_symbol: derived.quote_symbol,
    quote_amount: derived.quote_amount,
    maker: (swap.sender || "").toLowerCase(),
    status: "pending",
    raw: {
      logIndex: logItem.index,
      removed: logItem.removed,
      backfill: isBackfill,
      swap,
      pool_meta: meta
    }
  };

  await insertTrade(row);

  const last = await getSyncState("trades_last_block", null);
  const lastNum = last ? Number(last) : 0;
  if (logItem.blockNumber > lastNum) {
    await upsertSyncState("trades_last_block", logItem.blockNumber);
  }
};

const confirmLoop = async (getProvider) => {
  while (true) {
    try {
      const provider = getProvider();
      if (!provider) {
        await sleep(2000);
        continue;
      }
      const latest = await provider.getBlockNumber();
      const cutoff = latest - CONFIRMATIONS;
      if (cutoff > 0) {
        const supabase = getSupabaseAdminClient();
        const { data, error } = await supabase
          .from("trades")
          .select("tx_hash,block_number")
          .eq("status", "pending")
          .lte("block_number", cutoff)
          .limit(500);
        if (error) throw error;

        for (const row of data || []) {
          await markConfirmed(row.tx_hash);
        }
      }
    } catch (err) {
      const normalized = normalizeError(err);
      logger.error("confirm loop error", normalized.message);
    }
    await sleep(5000);
  }
};

const socketManager = createAlchemySocketManager({
  url: config.alchemy.wssRpcUrl,
  logger,
  getFilter,
  onReady: async (provider) => {
    const latest = await provider.getBlockNumber();
    const last = await getSyncState("trades_last_block", null);
    const start = last ? Number(last) + 1 : Math.max(latest - 5000, 0);

    if (start <= latest - 1) {
      await backfill(provider, start, latest - 1);
    }
  },
  onLog: async (logItem, provider) => {
    await handleLog(logItem, provider, false);
  }
});

const start = async () => {
  try {
    await runEndpointHealthChecks({ baseUrl: config.health.baseUrl, logger, config });
  } catch (err) {
    const normalized = normalizeError(err);
    logger.warn("healthcheck error", normalized.message);
  }

  await socketManager.connect();
  confirmLoop(socketManager.getProvider).catch((err) => {
    const normalized = normalizeError(err);
    logger.error("confirm loop crash", normalized.message);
  });
};

start().catch((err) => {
  const normalized = normalizeError(err);
  logger.error(normalized.message || err);
  process.exit(1);
});
