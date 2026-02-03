// Alchemy webhook verification helpers.

import crypto from "crypto";

/**
 * Verify an Alchemy webhook signature.
 * @param {string} rawBody
 * @param {string} signature
 * @param {string} signingKey
 */
export function verifyAlchemySignature(rawBody, signature, signingKey) {
  if (!signingKey) return true;
  if (!signature) return false;
  try {
    const hmac = crypto.createHmac("sha256", signingKey);
    hmac.update(rawBody);
    const digest = `sha256=${hmac.digest("hex")}`;
    return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(signature));
  } catch (_) {
    return false;
  }
}

/**
 * Validate a webhook token header/query value.
 * @param {string} provided
 * @param {string} expected
 */
export function verifyWebhookToken(provided, expected) {
  if (!expected) return true;
  return Boolean(provided && provided === expected);
}
