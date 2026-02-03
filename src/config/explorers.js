// Explorer (BaseScan/Etherscan) configuration helpers.

import { config } from "./env.js";

/**
 * Return explorer config slice.
 */
export function getExplorerConfig() {
  return {
    ...config.explorers,
    baseChainId: config.chain.baseChainId
  };
}
