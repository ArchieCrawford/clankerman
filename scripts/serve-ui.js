import "dotenv/config";
import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import balancesHandler from "../api/balances.js";
import priceHandler from "../api/price.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.join(__dirname, "..");
const WEB_ROOT = path.join(ROOT, "web");
const WEB_INDEX = path.join(WEB_ROOT, "index.html");

const log = (...args) => console.log(new Date().toISOString(), "[ui]", ...args);

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const BUYBACK_ADDRESS = process.env.BUYBACK_ADDRESS || "";
const TREASURY_ADDRESS = process.env.TREASURY_ADDRESS || "";
const BNKR_ADDRESS = process.env.BNKR_ADDRESS || "";

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
  .replace(/__BUYBACK_ADDRESS__/g, BUYBACK_ADDRESS)
  .replace(/__TREASURY_ADDRESS__/g, TREASURY_ADDRESS)
  .replace(/__BNKR_ADDRESS__/g, BNKR_ADDRESS);

const app = express();

app.get("/api/balances", balancesHandler);
app.get("/api/price", priceHandler);

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
app.get("*", (_, res) => {
  res.set("Content-Type", "text/html; charset=utf-8");
  res.send(html);
});

const PORT = process.env.UI_PORT ? Number(process.env.UI_PORT) : 4173;
app.listen(PORT, () => {
  log(`UI running at http://localhost:${PORT}`);
});
