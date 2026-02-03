// API handler for Alchemy webhook ingestion into Supabase.

import { strictApi } from "../config/env.js";
import { createLogger } from "../lib/logger.js";
import { normalizeError } from "../lib/errors.js";
import { getRequestId } from "../lib/http.js";
import { getSupabaseAdminClient } from "../services/supabase/client.js";
import { verifyWebhookToken } from "../services/alchemy/webhooks.js";
import { config } from "../config/env.js";

const logger = createLogger("api:alchemy-webhook");

const readBody = (req) => {
  if (req.body) return Promise.resolve(req.body);
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => {
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
};

/**
 * Vercel handler for Alchemy webhook ingest.
 * @param {import('http').IncomingMessage & { body?: any, headers?: any, method?: string, query?: any }} req
 * @param {import('http').ServerResponse & { json?: Function, status?: Function }} res
 */
export default async function alchemyWebhookIngestHandler(req, res) {
  const requestId = getRequestId(req);
  res.setHeader("Cache-Control", "no-store");

  const sendError = (status, message) => {
    logger.error("request error", { requestId, status, message });
    return res.status(status).json({ error: message, requestId });
  };

  if (req.method !== "POST") {
    return sendError(405, "method not allowed");
  }

  try {
    strictApi({ requireSupabase: true });
    const provided = req.headers["x-alchemy-token"] || req.headers["x-webhook-token"] || req.query?.token;
    if (!verifyWebhookToken(provided, config.alchemy.webhookToken)) {
      return sendError(401, "unauthorized");
    }

    const payload = await readBody(req);
    const supabase = getSupabaseAdminClient();

    const { error } = await supabase.from("webhook_events").insert({
      source: "alchemy",
      type: payload?.type ?? null,
      webhook_id: payload?.webhookId ?? null,
      created_at: payload?.createdAt ?? new Date().toISOString(),
      raw: payload || {}
    });

    if (error) throw error;

    return res.status(200).json({ ok: true });
  } catch (err) {
    const normalized = normalizeError(err);
    return sendError(normalized.status || 500, normalized.message || "error");
  }
}
