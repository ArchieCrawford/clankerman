// Alchemy-specific configuration helpers.

import { config } from "./env.js";

/**
 * Return the Alchemy config slice.
 */
export function getAlchemyConfig() {
  return config.alchemy;
}
