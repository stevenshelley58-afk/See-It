import { createClient } from "@supabase/supabase-js";
import type { AppEnv } from "@/lib/env";

export function createSupabaseServiceClient(env: AppEnv) {
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false }
  });
}

export function createSupabaseAnonClient(env: AppEnv) {
  return createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    auth: { persistSession: false }
  });
}
