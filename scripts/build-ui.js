import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.join(__dirname, "..");
const SRC = path.join(ROOT, "web", "index.html");
const DIST_DIR = path.join(ROOT, "dist");
const DIST = path.join(DIST_DIR, "index.html");

const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const BUYBACK_ADDRESS = process.env.BUYBACK_ADDRESS || "";
const TREASURY_ADDRESS = process.env.TREASURY_ADDRESS || "";
const BNKR_ADDRESS = process.env.BNKR_ADDRESS || "";
const FEE_ACCUM_ADDRESS = process.env.FEE_ACCUM_ADDRESS || "";

if (!SUPABASE_URL) throw new Error("SUPABASE_URL is required");
if (!SUPABASE_KEY) throw new Error("SUPABASE_ANON_KEY is required");

fs.mkdirSync(DIST_DIR, { recursive: true });
const tpl = fs.readFileSync(SRC, "utf8");
const out = tpl
  .replace(/__SUPABASE_URL__/g, SUPABASE_URL)
  .replace(/__SUPABASE_KEY__/g, SUPABASE_KEY)
  .replace(/__BUYBACK_ADDRESS__/g, BUYBACK_ADDRESS)
  .replace(/__TREASURY_ADDRESS__/g, TREASURY_ADDRESS)
  .replace(/__BNKR_ADDRESS__/g, BNKR_ADDRESS)
  .replace(/__FEE_ACCUM_ADDRESS__/g, FEE_ACCUM_ADDRESS);
fs.writeFileSync(DIST, out, "utf8");
console.log("Built dist/index.html");
