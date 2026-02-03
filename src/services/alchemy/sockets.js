// Websocket provider lifecycle manager with reconnects.

import { ethers } from "ethers";
import { normalizeError } from "../../lib/errors.js";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Create a websocket manager with reconnect logic.
 * @param {{
 *  url: string,
 *  logger: ReturnType<import('../../lib/logger.js').createLogger>,
 *  getFilter: () => object,
 *  onReady?: (provider: ethers.WebSocketProvider) => Promise<void> | void,
 *  onLog?: (log: any, provider: ethers.WebSocketProvider) => Promise<void> | void,
 *  reconnectDelayMs?: number,
 *  errorDelayMs?: number
 * }} options
 */
export function createAlchemySocketManager(options) {
  const {
    url,
    logger,
    getFilter,
    onReady,
    onLog,
    reconnectDelayMs = 3000,
    errorDelayMs = 5000
  } = options;

  let provider = null;
  let connecting = false;

  const getProvider = () => provider;

  const connect = async () => {
    if (connecting) return;
    connecting = true;
    try {
      provider = new ethers.WebSocketProvider(url);

      provider.on("error", (err) => {
        const normalized = normalizeError(err);
        logger.error("provider error", normalized.message);
      });

      provider.websocket?.on?.("close", async (code) => {
        logger.error(`websocket closed (${code ?? "unknown"}); attempting reconnect`);
        try {
          provider?.destroy?.();
        } catch (_) {}
        provider = null;
        await sleep(reconnectDelayMs);
        connecting = false;
        connect().catch((err) => {
          const normalized = normalizeError(err);
          logger.error("reconnect error", normalized.message);
        });
      });

      if (onReady) {
        await onReady(provider);
      }

      if (onLog) {
        provider.on(getFilter(), async (logItem) => {
          try {
            await onLog(logItem, provider);
          } catch (err) {
            const normalized = normalizeError(err);
            logger.error("log handler error", normalized.message);
          }
        });
      }
    } catch (err) {
      const normalized = normalizeError(err);
      logger.error("connect error", normalized.message);
      provider = null;
      await sleep(errorDelayMs);
      connect().catch((reconnectErr) => {
        const reconnectNormalized = normalizeError(reconnectErr);
        logger.error("reconnect error", reconnectNormalized.message);
      });
    } finally {
      connecting = false;
    }
  };

  return { connect, getProvider };
}
