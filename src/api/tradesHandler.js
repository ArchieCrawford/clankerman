// API handler for listing trades from Supabase.

import { createLogger } from "../lib/logger.js";
import { normalizeError } from "../lib/errors.js";
import { getRequestId } from "../lib/http.js";
import { strictApi, config } from "../config/env.js";
import { toInt, toLowerAddress } from "../lib/validate.js";

const logger = createLogger("api:trades");

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

const parseQuery = (req) => {
  if (req?.query && Object.keys(req.query).length) return req.query;
  try {
    const url = new URL(req.url || "", "http://localhost");
    const out = {};
    url.searchParams.forEach((value, key) => {
      out[key] = value;
    });
    return out;
  } catch (_) {
    return {};
  }
};

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
    strictApi({ requireSupabase: false });

    const filters = parseQuery(req);
    const limit = clamp(toInt(filters?.limit || "200", 200), 1, 1000);
    const sinceRaw = filters?.since ? new Date(filters.since) : null;
    const since = sinceRaw && !Number.isNaN(sinceRaw.getTime()) ? sinceRaw.toISOString() : null;
    const maker = filters?.maker ? toLowerAddress(filters.maker) : "";
    const pool = filters?.pool ? String(filters.pool).toLowerCase() : "";
    const status = filters?.status ? String(filters.status).toLowerCase() : "";

    const supabaseUrl = config.supabase.url;
    const supabaseKey = config.supabase.serviceRoleKey || config.supabase.anonKey;
    if (!supabaseUrl || !supabaseKey) {
      return sendError(500, "Supabase env missing");
    }

    const params = new URLSearchParams();
    params.set(
      "select",
      "tx_hash,block_number,block_time,pool_address,side,clanker_amount,quote_symbol,quote_amount,maker,status,chain"
    );
    params.set("order", "block_number.desc");
    params.set("limit", String(limit));
    if (since) params.set("block_time", `gte.${since}`);
    if (maker) params.set("maker", `eq.${maker}`);
    if (pool) params.set("pool_address", `ilike.*${pool}*`);
    if (status) params.set("status", `eq.${status}`);

      const baseUrl = String(supabaseUrl).replace(/\/+$/, "");
      const url = `${baseUrl}/rest/v1/trades?${params.toString()}`;
    const apiRes = await fetch(url, {
      headers: {
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`
      }
    });
    const text = await apiRes.text();
    if (!apiRes.ok) {
      throw new Error(`supabase http ${apiRes.status}: ${text || "no body"}`);
    }
    let data = [];
    try {
      data = text ? JSON.parse(text) : [];
    } catch (_) {
      data = [];
    }

    return res.status(200).json({ data: data || [], count: (data || []).length });
  } catch (err) {
    const normalized = normalizeError(err);
    return sendError(normalized.status || 500, normalized.message || "error");
  }
}
