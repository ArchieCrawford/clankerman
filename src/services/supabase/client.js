// Supabase admin client singleton.

import { AppError } from "../../lib/errors.js";
import { createSupabaseAdminClient } from "../../config/supabase.js";

const supabaseAdmin = createSupabaseAdminClient();

/**
 * Return the admin Supabase client or throw if env missing.
 */
export function getSupabaseAdminClient() {
  if (!supabaseAdmin) {
    throw new AppError("Supabase env missing", { status: 500, code: "ENV_MISSING" });
  }
  return supabaseAdmin;
}
