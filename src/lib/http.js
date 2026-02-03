// HTTP helpers for upstream API calls and request metadata.

/**
 * Fetch JSON with timeout and cache disabled.
 * @param {string} url
 * @param {RequestInit & { timeoutMs?: number }} [options]
 */
export async function fetchJson(url, options = {}) {
  const { timeoutMs = 15000, ...rest } = options;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error("timeout")), timeoutMs);

  if (rest.signal) {
    if (rest.signal.aborted) {
      controller.abort(rest.signal.reason);
    } else {
      rest.signal.addEventListener(
        "abort",
        () => controller.abort(rest.signal.reason),
        { once: true }
      );
    }
  }

  try {
    const res = await fetch(url, {
      ...rest,
      cache: rest.cache ?? "no-store",
      signal: controller.signal
    });
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch (_) {
      json = null;
    }
    return { ok: res.ok, status: res.status, json, text };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Determine request id from headers or generate a short id.
 * @param {import('http').IncomingMessage & { headers?: Record<string, string> }} req
 */
export function getRequestId(req) {
  const headerId = req?.headers?.["x-request-id"] || req?.headers?.["X-Request-Id"];
  if (headerId) return String(headerId);
  return Math.random().toString(36).slice(2, 10);
}
