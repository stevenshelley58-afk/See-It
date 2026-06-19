import { readFileSync, readdirSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { loadScriptEnv } from "./script-env";

loadScriptEnv();

const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY;

if (!supabaseUrl || !serviceKey) {
  throw new Error("Missing SUPABASE_URL and service-role key for runtime schema verification");
}

const migration = readdirSync("supabase/migrations")
  .filter((file) => file.endsWith(".sql"))
  .sort()
  .map((file) => readFileSync("supabase/migrations/" + file, "utf8"))
  .join("\n");
const expectedTables = [...migration.matchAll(/create table\s+(?:if not exists\s+)?([a-z_]+)/gi)]
  .map((match) => match[1])
  .filter((table, index, all) => all.indexOf(table) === index)
  .sort();

const client = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
const missing: string[] = [];
const inaccessible: Array<{ table: string; message: string }> = [];
const requireSeed = process.argv.includes("--require-seed");

for (const table of expectedTables) {
  const { error } = await client.from(table).select("*").limit(1);
  if (!error) {
    continue;
  }
  if (/Could not find the table|does not exist|schema cache/i.test(error.message)) {
    missing.push(table);
  } else {
    inaccessible.push({ table, message: error.message });
  }
}

if (missing.length > 0 || inaccessible.length > 0) {
  const details = [
    missing.length ? "missing tables: " + missing.join(", ") : "",
    ...inaccessible.map((item) => item.table + ": " + item.message)
  ].filter(Boolean).join("; ");
  throw new Error("Supabase runtime schema verification failed: " + details);
}

if (requireSeed) {
  const requiredSeedCounts: Record<string, number> = {
    ai_provider: 4,
    ai_model: 4,
    model_route_policy: 1,
    prompt_template: 2,
    prompt_version: 2,
    prompt_bundle: 1,
    prompt_bundle_version: 1,
    render_recipe: 1,
    render_recipe_version: 1,
    prompt_deployment: 1
  };
  const underseeded: string[] = [];
  for (const [table, minimum] of Object.entries(requiredSeedCounts)) {
    const { count, error } = await client.from(table).select("*", { head: true, count: "exact" });
    if (error) {
      throw new Error("Supabase seed verification failed for " + table + ": " + error.message);
    }
    if ((count ?? 0) < minimum) {
      underseeded.push(table + " expected >= " + minimum + " got " + (count ?? 0));
    }
  }
  if (underseeded.length > 0) {
    throw new Error("Supabase AI control plane seed incomplete: " + underseeded.join("; "));
  }
}

console.log("Supabase runtime schema verified " + expectedTables.length + " tables" + (requireSeed ? " with AI seed rows" : ""));
