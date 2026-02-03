// Supabase trade writes and updates.

import { getSupabaseAdminClient } from "./client.js";

/**
 * Insert a trade row, ignoring duplicate constraint errors.
 * @param {Record<string, any>} row
 */
export async function insertTrade(row) {
  const supabase = getSupabaseAdminClient();
  const { error } = await supabase.from("trades").insert(row);
  if (error) {
    const message = String(error.message || "").toLowerCase();
    if (message.includes("duplicate")) return;
    if (String(error.code || "") === "23505") return;
    throw error;
  }
}

/**
 * Mark a trade as confirmed.
 * @param {string} txHash
 */
export async function markConfirmed(txHash) {
  const supabase = getSupabaseAdminClient();
  const { error } = await supabase
    .from("trades")
    .update({ status: "confirmed" })
    .eq("tx_hash", txHash)
    .eq("status", "pending");
  if (error) throw error;
}
