// API handler for Alchemy activity webhooks.

import { config } from "../config/env.js";
import { createLogger } from "../lib/logger.js";
import { normalizeError } from "../lib/errors.js";
import { getRequestId } from "../lib/http.js";
import { verifyAlchemySignature } from "../services/alchemy/webhooks.js";

const logger = createLogger("api:webhook");

/**
 * Vercel handler for Alchemy webhook events.
 * @param {import('http').IncomingMessage & { body?: any, rawBody?: any, headers?: any }} req
 * @param {import('http').ServerResponse & { json?: Function, status?: Function }} res
 */
export default async function webhookHandler(req, res) {
  const requestId = getRequestId(req);
  res.setHeader("Cache-Control", "no-store");

  const sendError = (status, message) => {
    logger.error("request error", { requestId, status, message });
    return res.status(status).json({ error: message, requestId });
  };

  try {
    const signature = req.headers?.["x-alchemy-signature"] || req.headers?.["X-Alchemy-Signature"];
    const raw = typeof req.rawBody === "string"
      ? req.rawBody
      : typeof req.body === "string"
      ? req.body
      : JSON.stringify(req.body || {});

    const valid = verifyAlchemySignature(raw, signature, config.alchemy.webhookSigningKey);
    if (!valid) return sendError(401, "invalid signature");

    const treasury = config.tokens.treasury;
    const buyback = config.tokens.buyback;

    const activities = req.body?.event?.activity || [];
    const interesting = activities.filter((activity) => {
      const from = (activity?.fromAddress || "").toLowerCase();
      const to = (activity?.toAddress || "").toLowerCase();
      return (treasury && (from === treasury || to === treasury)) || (buyback && (from === buyback || to === buyback));
    });

    interesting.forEach((activity) => {
      logger.info("tx", activity.hash, "from", activity.fromAddress, "to", activity.toAddress, "value", activity.value);
    });

    return res.status(200).json({ ok: true, received: activities.length, matched: interesting.length });
  } catch (err) {
    const normalized = normalizeError(err);
    return sendError(normalized.status || 500, normalized.message || "error");
  }
}
