// Webhook configuration helpers.

import { config } from "./env.js";

/**
 * Return webhook-related config values.
 */
export function getWebhookConfig() {
  return {
    signingKey: config.alchemy.webhookSigningKey,
    token: config.alchemy.webhookToken
  };
}
