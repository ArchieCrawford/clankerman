import "dotenv/config";
import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import balancesHandler from "../api/balances.js";
import priceHandler from "../api/price.js";
import tradesHandler from "../api/trades.js";
import webhookHandler from "../api/webhook.js";
import alchemyWebhookHandler from "../api/webhooks/alchemy.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.join(__dirname, "..");
const WEB_ROOT = path.join(ROOT, "web");
const WEB_INDEX = path.join(WEB_ROOT, "index.html");

const log = (...args) => console.log(new Date().toISOString(), "[ui]", ...args);

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const API_BASE_URL = process.env.API_BASE_URL || process.env.NEXT_PUBLIC_API_BASE_URL || "";
const REALTIME_ENABLED = process.env.REALTIME_ENABLED || process.env.SUPABASE_REALTIME || "false";
const BUYBACK_ADDRESS = process.env.BUYBACK_ADDRESS || "";
const TREASURY_ADDRESS = process.env.TREASURY_ADDRESS || "";
const BNKR_ADDRESS = process.env.BNKR_ADDRESS || "";
const FEE_ACCUM_ADDRESS = process.env.FEE_ACCUM_ADDRESS || "";

if (!SUPABASE_URL) {
  console.error("Missing SUPABASE_URL in .env");
  process.exit(1);
}
if (!SUPABASE_KEY) {
  console.error("Missing SUPABASE_ANON_KEY (preferred) or SUPABASE_SERVICE_ROLE_KEY in .env");
  process.exit(1);
}
if (!process.env.SUPABASE_ANON_KEY) {
  log("Warning: using service role key for UI; prefer SUPABASE_ANON_KEY for browser usage.");
}

const template = fs.readFileSync(WEB_INDEX, "utf8");
const html = template
  .replace(/__SUPABASE_URL__/g, SUPABASE_URL)
  .replace(/__SUPABASE_KEY__/g, SUPABASE_KEY)
  .replace(/__API_BASE_URL__/g, API_BASE_URL)
  .replace(/__REALTIME_ENABLED__/g, REALTIME_ENABLED)
  .replace(/__BUYBACK_ADDRESS__/g, BUYBACK_ADDRESS)
  .replace(/__TREASURY_ADDRESS__/g, TREASURY_ADDRESS)
  .replace(/__BNKR_ADDRESS__/g, BNKR_ADDRESS)
  .replace(/__FEE_ACCUM_ADDRESS__/g, FEE_ACCUM_ADDRESS);

const app = express();
app.use(express.json({
  limit: "2mb",
  verify: (req, _res, buf) => {
    req.rawBody = buf.toString("utf8");
  }
}));

app.get("/api/balances", balancesHandler);
app.get("/api/price", priceHandler);
app.get("/api/trades", tradesHandler);
app.get("/api/webhook", (_req, res) => res.status(405).json({ error: "method not allowed" }));
app.post("/api/webhook", webhookHandler);
app.get("/api/webhooks/alchemy", (_req, res) => res.status(405).json({ error: "method not allowed" }));
app.post("/api/webhooks/alchemy", alchemyWebhookHandler);
app.use("/api", (req, res) => res.status(404).json({ error: "not found" }));

// Serve injected HTML for index routes
app.get("/", (_, res) => {
  res.set("Content-Type", "text/html; charset=utf-8");
  res.send(html);
});

app.get("/index.html", (_, res) => {
  res.set("Content-Type", "text/html; charset=utf-8");
  res.send(html);
});

// Static assets, but never auto-serve index
app.use(express.static(WEB_ROOT, { index: false }));

// SPA fallback
app.get("*", (req, res) => {
  if (req.path.startsWith("/api/")) {
    return res.status(404).json({ error: "not found" });
  }
  res.set("Content-Type", "text/html; charset=utf-8");
  res.send(html);
});

const PORT = process.env.UI_PORT ? Number(process.env.UI_PORT) : 4173;
app.listen(PORT, () => {
  log(`UI running at http://localhost:${PORT}`);
});
