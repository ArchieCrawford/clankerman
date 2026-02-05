// API handler for listing trades from Supabase.

import { createLogger } from "../lib/logger.js";
import { normalizeError } from "../lib/errors.js";
import { getRequestId } from "../lib/http.js";
import { strictApi } from "../config/env.js";
import { getSupabaseAdminClient } from "../services/supabase/client.js";
import { toInt, toLowerAddress } from "../lib/validate.js";

const logger = createLogger("api:trades");

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

/**
 * Vercel handler for trades list.
 * @param {import('http').IncomingMessage & { query?: any, headers?: any, method?: string }} req
 * @param {import('http').ServerResponse & { json?: Function, status?: Function }} res
 */
export default async function tradesHandler(req, res) {
  const requestId = getRequestId(req);
  res.setHeader("Cache-Control", "no-store");

  const sendError = (status, message) => {
    logger.error("request error", { requestId, status, message });
    return res.status(status).json({ error: message, requestId });
  };

  if (req.method !== "GET") {
    return sendError(405, "method not allowed");
  }

  try {
    strictApi({ requireSupabase: true });

    const limit = clamp(toInt(req.query?.limit || "200", 200), 1, 1000);
    const since = req.query?.since ? new Date(req.query.since).toISOString() : null;
    const maker = req.query?.maker ? toLowerAddress(req.query.maker) : "";
    const pool = req.query?.pool ? String(req.query.pool).toLowerCase() : "";
    const status = req.query?.status ? String(req.query.status).toLowerCase() : "";

    const supabase = getSupabaseAdminClient();
    let query = supabase
      .from("trades")
      .select("tx_hash,block_number,block_time,pool_address,side,clanker_amount,quote_symbol,quote_amount,maker,status,chain")
      .order("block_number", { ascending: false })
      .limit(limit);

    if (since) query = query.gte("block_time", since);
    if (maker) query = query.eq("maker", maker);
    if (pool) query = query.ilike("pool_address", `%${pool}%`);
    if (status) query = query.eq("status", status);

    const { data, error } = await query;
    if (error) throw error;

    return res.status(200).json({ data: data || [], count: (data || []).length });
  } catch (err) {
    const normalized = normalizeError(err);
    return sendError(normalized.status || 500, normalized.message || "error");
  }
}
