import "dotenv/config";
import fs from "fs";

const API_BASE = "https://dashboard.alchemy.com/api";

const token = process.env.ALCHEMY_WEBHOOK_TOKEN || process.env.ALCHEMY_NOTIFY_TOKEN || "";
if (!token) {
  console.error("Missing ALCHEMY_WEBHOOK_TOKEN (used as X-Alchemy-Token)");
  process.exit(1);
}

const cmd = (process.argv[2] || "list").toLowerCase();

const usage = () => {
  console.log(`\nAlchemy Notify API helper\n\nCommands:\n  list                     List team webhooks\n  create                   Create a webhook (requires env or --body/--body-json)\n\nOptions:\n  --body <path>            JSON file for create payload\n  --body-json <string>     Inline JSON for create payload\n\nEnv defaults for create:\n  ALCHEMY_WEBHOOK_URL or WEBHOOK_URL\n  ALCHEMY_WEBHOOK_TYPE or WEBHOOK_TYPE\n  ALCHEMY_WEBHOOK_NETWORK or WEBHOOK_NETWORK (default: BASE_MAINNET)\n  ALCHEMY_WEBHOOK_ADDRESSES or WEBHOOK_ADDRESSES (comma-separated)\n  ALCHEMY_WEBHOOK_NAME or WEBHOOK_NAME (default: clanker-webhook)\n  ALCHEMY_APP_ID or Alchemy_APP_ID (optional)\n`);
};

const readJsonFile = (path) => {
  const raw = fs.readFileSync(path, "utf8");
  return JSON.parse(raw);
};

const parseJsonArg = (flag) => {
  const idx = process.argv.indexOf(flag);
  if (idx === -1) return null;
  const value = process.argv[idx + 1];
  if (!value) {
    throw new Error(`${flag} requires a value`);
  }
  if (flag === "--body") return readJsonFile(value);
  return JSON.parse(value);
};

const buildBodyFromEnv = () => {
  const webhookUrl = process.env.ALCHEMY_WEBHOOK_URL || process.env.WEBHOOK_URL || "";
  const webhookType = process.env.ALCHEMY_WEBHOOK_TYPE || process.env.WEBHOOK_TYPE || "";
  const network = process.env.ALCHEMY_WEBHOOK_NETWORK || process.env.WEBHOOK_NETWORK || "BASE_MAINNET";
  const name = process.env.ALCHEMY_WEBHOOK_NAME || process.env.WEBHOOK_NAME || "clanker-webhook";
  const addresses = (process.env.ALCHEMY_WEBHOOK_ADDRESSES || process.env.WEBHOOK_ADDRESSES || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const appId = process.env.ALCHEMY_APP_ID || process.env.Alchemy_APP_ID || "";

  if (!webhookUrl || !webhookType) {
    throw new Error("Missing ALCHEMY_WEBHOOK_URL/ALCHEMY_WEBHOOK_TYPE (or use --body/--body-json)");
  }

  const body = {
    name,
    webhook_type: webhookType,
    webhook_url: webhookUrl,
    network
  };

  if (addresses.length) body.addresses = addresses;
  if (appId) body.app_id = appId;

  return body;
};

async function request(method, path, body) {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      "accept": "application/json",
      "X-Alchemy-Token": token
    },
    body: body ? JSON.stringify(body) : undefined
  });

  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch (_) {
    json = null;
  }

  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${text || ""}`.trim());
  }

  return json ?? text;
}

async function run() {
  if (cmd === "list") {
    const data = await request("GET", "/team-webhooks");
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  if (cmd === "create") {
    const bodyFromArg = parseJsonArg("--body") || parseJsonArg("--body-json");
    const body = bodyFromArg || buildBodyFromEnv();
    const data = await request("POST", "/create-webhook", body);
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  usage();
  process.exit(1);
}

run().catch((err) => {
  console.error(err?.message || err);
  process.exit(1);
});
