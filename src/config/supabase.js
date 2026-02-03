// Supabase client factory helpers.

import { createClient } from "@supabase/supabase-js";
import { config } from "./env.js";

/**
 * Create an admin Supabase client when env is available.
 */
export function createSupabaseAdminClient() {
  if (!config.supabase.url || !config.supabase.serviceRoleKey) return null;
  return createClient(config.supabase.url, config.supabase.serviceRoleKey);
}

/**
 * Create an anon Supabase client when env is available.
 */
export function createSupabaseAnonClient() {
  if (!config.supabase.url || !config.supabase.anonKey) return null;
  return createClient(config.supabase.url, config.supabase.anonKey);
}
