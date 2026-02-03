// Supabase sync_state helpers.

import { getSupabaseAdminClient } from "./client.js";

/**
 * Upsert a sync state value.
 * @param {string} key
 * @param {string|number} value
 */
export async function upsertSyncState(key, value) {
  const supabase = getSupabaseAdminClient();
  const { error } = await supabase.from("sync_state").upsert({ key, value: String(value) });
  if (error) throw error;
}

/**
 * Read a sync state value.
 * @param {string} key
 * @param {string|null} [fallback]
 */
export async function getSyncState(key, fallback = null) {
  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase.from("sync_state").select("value").eq("key", key).maybeSingle();
  if (error) throw error;
  return data?.value ?? fallback;
}
