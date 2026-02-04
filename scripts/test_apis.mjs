import "dotenv/config";

const BASE_URL =
  process.env.TEST_BASE_URL ||
  process.env.API_BASE_URL ||
  process.env.BASE_URL ||
  `http://localhost:${process.env.PORT || "4173"}`;

const timeoutMs = Number(process.env.TEST_TIMEOUT_MS || "12000");

function withTimeout(promise, ms, ac) {
  const t = setTimeout(() => ac.abort(), ms);
  return { done: promise.finally(() => clearTimeout(t)) };
}

async function req(method, path, { body, headers } = {}) {
  const url = `${BASE_URL}${path}`;
  const opts = {
    method,
    headers: {
      "accept": "application/json",
      ...(body ? { "content-type": "application/json" } : {}),
      ...(headers || {})
    }
  };

  if (body) opts.body = JSON.stringify(body);

  const ac = new AbortController();
  const { done } = withTimeout(fetch(url, { ...opts, signal: ac.signal }), timeoutMs, ac);

  let res;
  try {
    res = await done;
  } catch (e) {
    if (e?.name === "AbortError") throw new Error(`TIMEOUT ${timeoutMs}ms ${method} ${path}`);
    throw e;
  }

  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch {}

  return { url, status: res.status, ok: res.ok, text, json, headers: Object.fromEntries(res.headers.entries()) };
}

function isMissing(x) {
  return x == null || x === "" || x === "—";
}

function pickPrice(json) {
  if (!json || typeof json !== "object") return null;
  const p = json.price ?? json.data?.price ?? json.result?.price;
  if (isMissing(p)) return null;
  const n = typeof p === "string" ? Number(p) : p;
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

function pickNativeBalance(json) {
  if (!json || typeof json !== "object") return null;

  const candidates = [
    json.native,
    json.nativeBalance,
    json.native_balance,
    json.result?.native,
    json.result?.nativeBalance,
    json.balances?.native,
    json.balances?.eth,
    json.eth,
    json.ETH,
  ].filter((v) => v != null);

  for (const c of candidates) {
    if (typeof c === "string") {
      if (!c.trim()) continue;
      // accept "0" but healthcheck wanted "missing", so treat blank only as missing
      return c;
    }
    if (typeof c === "number") return String(c);
    if (typeof c === "object") {
      // sometimes returned as { raw, formatted }
      if (c.raw != null) return String(c.raw);
      if (c.formatted != null) return String(c.formatted);
      if (c.balanceRaw != null) return String(c.balanceRaw);
      if (c.balance != null) return String(c.balance);
      if (c.value != null) return String(c.value);
    }
  }

  return null;
}

async function test(name, fn) {
  const start = Date.now();
  try {
    const out = await fn();
    return { name, ok: true, ms: Date.now() - start, ...out };
  } catch (e) {
    return { name, ok: false, ms: Date.now() - start, error: e.message || String(e) };
  }
}

async function main() {
  const results = [];

  results.push(await test("GET /api/price returns price", async () => {
    const r = await req("GET", "/api/price");
    if (r.status !== 200) throw new Error(`Expected 200, got ${r.status}`);
    const price = pickPrice(r.json);
    if (price == null) throw new Error(`missing price (body=${r.text.slice(0, 200)})`);
    return { status: r.status, price };
  }));

  results.push(await test("GET /api/balances returns native balance", async () => {
    const addr = process.env.TEST_TREASURY_ADDRESS || process.env.TREASURY_ADDRESS;
    if (!addr) throw new Error("Set TEST_TREASURY_ADDRESS or TREASURY_ADDRESS in env");
    const r = await req("GET", `/api/balances?address=${encodeURIComponent(addr)}`);
    if (r.status !== 200) throw new Error(`Expected 200, got ${r.status}`);
    const native = pickNativeBalance(r.json);
    if (native == null) throw new Error(`missing native balance (body=${r.text.slice(0, 250)})`);
    return { status: r.status, native };
  }));

  results.push(await test("GET /api/webhook returns 405 (expected)", async () => {
    const r = await req("GET", "/api/webhook");
    if (r.status !== 405) throw new Error(`Expected 405, got ${r.status} (body=${r.text.slice(0, 120)})`);
    return { status: r.status };
  }));

  results.push(await test("POST /api/webhook accepts request (or returns handled error)", async () => {
    const r = await req("POST", "/api/webhook", {
      body: { test: true, ts: new Date().toISOString() }
    });
    // Some handlers return 200/204 for ok, some return 400 for bad signature. Both prove POST route exists.
    if (![200, 201, 202, 204, 400, 401].includes(r.status)) {
      throw new Error(`Unexpected status ${r.status} (body=${r.text.slice(0, 200)})`);
    }
    return { status: r.status };
  }));

  results.push(await test("GET /api/webhooks/alchemy returns 405 (expected)", async () => {
    const r = await req("GET", "/api/webhooks/alchemy");
    if (r.status !== 405) throw new Error(`Expected 405, got ${r.status} (body=${r.text.slice(0, 120)})`);
    return { status: r.status };
  }));

  results.push(await test("POST /api/webhooks/alchemy accepts request (or returns handled error)", async () => {
    const r = await req("POST", "/api/webhooks/alchemy", {
      body: { webhook: "alchemy", test: true, ts: new Date().toISOString() }
    });
    if (![200, 201, 202, 204, 400, 401].includes(r.status)) {
      throw new Error(`Unexpected status ${r.status} (body=${r.text.slice(0, 200)})`);
    }
    return { status: r.status };
  }));

  const pad = (s, n) => (s + " ".repeat(n)).slice(0, n);
  console.log(`\nAPI Test Target: ${BASE_URL}\n`);
  for (const r of results) {
    const status = r.ok ? "PASS" : "FAIL";
    const detail = r.ok
      ? Object.entries(r).filter(([k]) => !["name", "ok", "ms"].includes(k)).map(([k, v]) => `${k}=${v}`).join(" ")
      : `error=${r.error}`;
    console.log(`${pad(status, 5)} ${pad(r.name, 48)} ${String(r.ms).padStart(5)}ms  ${detail}`);
  }

  const failed = results.filter((r) => !r.ok);
  if (failed.length) {
    process.exit(1);
  }
  process.exit(0);
}

main();
