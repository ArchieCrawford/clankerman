import crypto from "crypto";

export default async function handler(req, res) {
  const SIGNING_KEY = process.env.ALCHEMY_WEBHOOK_SIGNING_KEY || "";
  const TREASURY = (process.env.TREASURY_ADDRESS || "").toLowerCase();
  const BUYBACK = (process.env.BUYBACK_ADDRESS || "").toLowerCase();

  // Alchemy sends x-alchemy-signature header: sha256=<hex>
  const signature = req.headers?.["x-alchemy-signature"] || req.headers?.["X-Alchemy-Signature"];

  // Best-effort raw body reconstruction (Vercel/Node may not expose rawBody).
  const raw = typeof req.rawBody === "string" ? req.rawBody : typeof req.body === "string" ? req.body : JSON.stringify(req.body || {});

  const verify = () => {
    if (!SIGNING_KEY || !signature) return SIGNING_KEY ? false : true; // allow through when no key is set
    try {
      const hmac = crypto.createHmac("sha256", SIGNING_KEY);
      hmac.update(raw);
      const digest = `sha256=${hmac.digest("hex")}`;
      return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(signature));
    } catch (_) {
      return false;
    }
  };

  if (!verify()) {
    return res.status(401).json({ error: "invalid signature" });
  }

  const activities = req.body?.event?.activity || [];
  const interesting = activities.filter((a) => {
    const from = (a?.fromAddress || "").toLowerCase();
    const to = (a?.toAddress || "").toLowerCase();
    return (TREASURY && (from === TREASURY || to === TREASURY)) || (BUYBACK && (from === BUYBACK || to === BUYBACK));
  });

  // Log minimal info; you can extend to insert into Supabase or notify Telegram.
  interesting.forEach((a) => {
    console.log("[webhook] tx", a.hash, "from", a.fromAddress, "to", a.toAddress, "value", a.value);
  });

  return res.status(200).json({ ok: true, received: activities.length, matched: interesting.length });
}
