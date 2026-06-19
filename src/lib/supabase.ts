import { createClient } from "@supabase/supabase-js";
import type { SupabaseRuntimeEnv } from "@/lib/env";

export function createSupabaseServiceClient(env: SupabaseRuntimeEnv) {
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false }
  });
}

export function createSupabaseAnonClient(env: SupabaseRuntimeEnv) {
  return createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    auth: { persistSession: false }
  });
}
