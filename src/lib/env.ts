import { z } from "zod";

const envSchema = z.object({
  APP_ENV: z.enum(["development", "test", "preview", "production"]).default("development"),
  APP_URL: z.string().url(),
  DATABASE_URL: z.string().min(1),
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_KEY: z.string().min(1),
  SUPABASE_ANON_KEY: z.string().min(1),
  SHOPIFY_API_KEY: z.string().min(1),
  SHOPIFY_API_SECRET: z.string().min(1),
  SHOPIFY_APP_URL: z.string().url(),
  SHOPIFY_API_VERSION: z.string().min(1),
  FOUNDER_PASSWORD: z.string().min(1),
  CRON_SECRET: z.string().min(1),
  ENCRYPTION_KEY: z.string().min(1),
  DEMO_BASE_URL: z.string().url(),
  GEMINI_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  BFL_API_KEY: z.string().optional(),
  IDEOGRAM_API_KEY: z.string().optional(),
  REVE_API_KEY: z.string().optional(),
  CUSTOM_IMAGE_API_KEY: z.string().optional(),
  CUSTOM_IMAGE_API_BASE_URL: z.string().url().optional().or(z.literal("")),
  LOCAL_IMAGE_MODEL_BASE_URL: z.string().url().optional().or(z.literal("")),
  INSTANTLY_API_KEY: z.string().optional(),
  ZEROBOUNCE_API_KEY: z.string().optional(),
  FOUNDER_EMAIL: z.string().email().optional().or(z.literal("")),
  SUPPORT_EMAIL: z.string().email().optional().or(z.literal(""))
});

export type AppEnv = z.infer<typeof envSchema>;
export type SupabaseRuntimeEnv = Pick<AppEnv, "APP_ENV" | "SUPABASE_URL" | "SUPABASE_SERVICE_KEY" | "SUPABASE_ANON_KEY">;

export function readEnv(source: Record<string, string | undefined> = process.env): AppEnv {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const names = parsed.error.issues.map((issue) => issue.path.join(".") || issue.message).join(", ");
    throw new Error("Missing or invalid environment variables: " + names);
  }
  return parsed.data;
}

export function readSupabaseEnv(source: Record<string, string | undefined> = process.env): SupabaseRuntimeEnv {
  const supabaseUrl = source.SUPABASE_URL ?? source.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = source.SUPABASE_SERVICE_KEY ?? source.SUPABASE_SERVICE_ROLE_KEY ?? source.SUPABASE_SECRET_KEY;
  const anonKey = source.SUPABASE_ANON_KEY ?? source.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? source.SUPABASE_PUBLISHABLE_KEY ?? source.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!supabaseUrl || !serviceKey || !anonKey) {
    throw new Error("Missing Supabase runtime environment variables");
  }
  return {
    APP_ENV: source.APP_ENV === "test" || source.APP_ENV === "preview" || source.APP_ENV === "production" ? source.APP_ENV : "development",
    SUPABASE_URL: supabaseUrl,
    SUPABASE_SERVICE_KEY: serviceKey,
    SUPABASE_ANON_KEY: anonKey
  };
}

export function providerSecretStatus(env: Partial<AppEnv>) {
  return {
    gemini: Boolean(env.GEMINI_API_KEY),
    openai: Boolean(env.OPENAI_API_KEY),
    "custom-http": Boolean(env.CUSTOM_IMAGE_API_KEY && env.CUSTOM_IMAGE_API_BASE_URL),
    local: true,
    flux: Boolean(env.BFL_API_KEY),
    ideogram: Boolean(env.IDEOGRAM_API_KEY),
    reve: Boolean(env.REVE_API_KEY)
  };
}
