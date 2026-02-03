// Endpoint health checks for API and webhook routes.

import crypto from "crypto";
import { fetchJson } from "../../lib/http.js";
import { normalizeError, AppError } from "../../lib/errors.js";

const normalizeBaseUrl = (baseUrl) => String(baseUrl || "").replace(/\/+$/, "");

const buildUrl = (baseUrl, path) => `${normalizeBaseUrl(baseUrl)}${path.startsWith("/") ? "" : "/"}${path}`;

/**
 * Run API endpoint health checks and log results.
 * @param {{ baseUrl: string, logger: ReturnType<import('../../lib/logger.js').createLogger>, config: any }} options
 */
export async function runEndpointHealthChecks(options) {
  const { baseUrl, logger, config } = options;
  if (!baseUrl) {
    logger.info("healthcheck skipped (HEALTHCHECK_BASE_URL not set)");
    return [];
  }

  const results = [];

  const record = (name, status, ok, note) => {
    results.push({ name, status, ok, note });
    if (ok) {
      logger.info(`healthcheck ${name}: ok (${status})${note ? ` - ${note}` : ""}`);
    } else {
      logger.warn(`healthcheck ${name}: failed (${status})${note ? ` - ${note}` : ""}`);
    }
  };

  const runCheck = async (name, fn) => {
    try {
      const { status, ok, note } = await fn();
      record(name, status, ok, note);
    } catch (err) {
      const normalized = normalizeError(err);
      record(name, normalized.status || "error", false, normalized.message || "error");
    }
  };

  await runCheck("api/price", async () => {
    const url = buildUrl(baseUrl, "/api/price?token=clanker&range=24h");
    const { ok, status, json } = await fetchJson(url);
    if (!ok) throw new AppError(`http ${status}`, { status, code: "HEALTHCHECK" });
    const price = Number(json?.price);
    const note = Number.isFinite(price) ? `price ${price}` : "missing price";
    return { ok: true, status, note };
  });

  await runCheck("api/balances", async () => {
    const url = buildUrl(baseUrl, "/api/balances");
    const { ok, status, json } = await fetchJson(url);
    if (!ok) throw new AppError(`http ${status}`, { status, code: "HEALTHCHECK" });
    const note = json?.native?.balanceRaw ? "native balance ok" : "missing native balance";
    return { ok: true, status, note };
  });

  await runCheck("api/webhook", async () => {
    const url = buildUrl(baseUrl, "/api/webhook");
    const payload = { event: { activity: [] } };
    const body = JSON.stringify(payload);
    const headers = { "Content-Type": "application/json" };

    if (config?.alchemy?.webhookSigningKey) {
      const hmac = crypto.createHmac("sha256", config.alchemy.webhookSigningKey);
      hmac.update(body);
      headers["x-alchemy-signature"] = `sha256=${hmac.digest("hex")}`;
    }

    const { ok, status, json } = await fetchJson(url, {
      method: "POST",
      headers,
      body
    });

    if (!ok) throw new AppError(`http ${status}`, { status, code: "HEALTHCHECK" });
    const note = json?.ok ? "webhook ok" : "unexpected response";
    return { ok: true, status, note };
  });

  await runCheck("api/webhooks/alchemy", async () => {
    const url = buildUrl(baseUrl, "/api/webhooks/alchemy");
    const payload = {
      type: "healthcheck",
      webhookId: "healthcheck",
      createdAt: new Date().toISOString(),
      event: { activity: [] }
    };
    const body = JSON.stringify(payload);
    const headers = { "Content-Type": "application/json" };
    if (config?.alchemy?.webhookToken) {
      headers["x-alchemy-token"] = config.alchemy.webhookToken;
    }

    const { ok, status, json } = await fetchJson(url, {
      method: "POST",
      headers,
      body
    });

    if (!ok) throw new AppError(`http ${status}`, { status, code: "HEALTHCHECK" });
    const note = json?.ok ? "ingest ok" : "unexpected response";
    return { ok: true, status, note };
  });

  const okCount = results.filter((r) => r.ok).length;
  logger.info(`healthcheck summary: ${okCount}/${results.length} ok`);

  return results;
}
