import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  : null;

const WEBHOOK_TOKEN = process.env.ALCHEMY_WEBHOOK_TOKEN || "";

function readBody(req) {
  if (req.body) return Promise.resolve(req.body);
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => {
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  if (!supabase) {
    return res.status(500).json({ error: "Supabase env missing" });
  }

  if (WEBHOOK_TOKEN) {
    const provided = req.headers["x-alchemy-token"] || req.headers["x-webhook-token"] || req.query?.token;
    if (!provided || provided !== WEBHOOK_TOKEN) {
      return res.status(401).json({ error: "unauthorized" });
    }
  }

  try {
    const payload = await readBody(req);

    const { error } = await supabase.from("webhook_events").insert({
      source: "alchemy",
      type: payload?.type ?? null,
      webhook_id: payload?.webhookId ?? null,
      created_at: payload?.createdAt ?? new Date().toISOString(),
      raw: payload || {}
    });

    if (error) throw error;

    return res.status(200).json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: e?.message || "error" });
  }
}
