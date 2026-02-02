import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import "dotenv/config";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const SRC = path.join(ROOT, "web", "index.html");
const STYLE_SRC = path.join(ROOT, "web", "style");
const DIST_DIR = path.join(ROOT, "dist");
const DIST = path.join(DIST_DIR, "index.html");
const DIST_STYLE = path.join(DIST_DIR, "style");

const env = {
  SUPABASE_URL: process.env.SUPABASE_URL,
  SUPABASE_KEY: process.env.SUPABASE_ANON_KEY, // Never inject Service Role into HTML
  BUYBACK_ADDRESS: process.env.BUYBACK_ADDRESS || "0x1195B555885C313614AF705D97db22881D2fbABD",
  TREASURY_ADDRESS: process.env.TREASURY_ADDRESS || "0x8D4aB2A3E89EadfDC729204adF863A0Bfc7746F6",
  BNKR_ADDRESS: process.env.BNKR_ADDRESS || "0x22af33fe49fd1fa80c7149773dde5890d3c76f3b",
  FEE_ACCUM_ADDRESS: process.env.FEE_ACCUM_ADDRESS || "0xaF6E8f06c2c72c38D076Edc1ab2B5C2eA2bc365C",
  BUILD_TIME: new Date().toLocaleString()
};

// Validation
if (!env.SUPABASE_URL || !env.SUPABASE_KEY) {
  console.error("❌ Error: SUPABASE_URL and SUPABASE_ANON_KEY must be in .env");
  process.exit(1);
}

console.log(`🏗️  Building dashboard for Treasury: ${env.TREASURY_ADDRESS}`);

fs.mkdirSync(DIST_DIR, { recursive: true });
let html = fs.readFileSync(SRC, "utf8");

// Loop through env object and replace __KEY__ with value
Object.keys(env).forEach(key => {
  const placeholder = new RegExp(`__${key}__`, 'g');
  html = html.replace(placeholder, env[key]);
});

fs.writeFileSync(DIST, html, "utf8");
// Copy styles so CSS is available alongside built HTML
if (fs.existsSync(STYLE_SRC)) {
  fs.rmSync(DIST_STYLE, { recursive: true, force: true });
  fs.cpSync(STYLE_SRC, DIST_STYLE, { recursive: true });
}
console.log("✅ Build complete: dist/index.html");
