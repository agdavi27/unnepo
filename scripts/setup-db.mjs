import { readFileSync, existsSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import postgres from "postgres";

function loadEnv() {
  if (!existsSync(".env.local")) return;
  for (const line of readFileSync(".env.local", "utf8").split("\n")) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }
}

function mask(value) {
  if (!value) return "(missing)";
  return `${value.slice(0, 12)}… (${value.length} chars)`;
}

loadEnv();

const databaseUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.SUPABASE_DB_URL || "";
const supabaseUrl = process.env.SUPABASE_URL || "";
const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

async function pingPostgres(url) {
    const sql = postgres(url, {
      ssl: "require",
      max: 1,
      idle_timeout: 5,
      connect_timeout: 15,
      prepare: false,
      onnotice: () => {},
    });
  try {
    await sql`
      create table if not exists app_state (
        id text primary key,
        data jsonb not null,
        version bigint not null default 0
      )
    `;
    const rows = await sql`select count(*)::int as count from app_state`;
    return rows[0].count;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

async function pingSupabase(url, key) {
  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error, count } = await client.from("app_state").select("id", { count: "exact", head: true });
  if (error) {
    if (error.code === "42P01" || error.code === "PGRST205" || /app_state/i.test(error.message || "")) {
      throw new Error("The app_state table is missing. Open the Supabase SQL editor and run supabase/setup.sql.");
    }
    throw new Error(error.message);
  }
  return count ?? 0;
}

async function main() {
  console.log("Checking database configuration…");
  console.log(`DATABASE_URL: ${databaseUrl ? mask(databaseUrl) : "(missing)"}`);
  console.log(`SUPABASE_URL: ${supabaseUrl || "(missing)"}`);
  console.log(`SUPABASE_SERVICE_ROLE_KEY: ${serviceRole ? mask(serviceRole) : "(missing)"}`);

  if (databaseUrl) {
    const count = await pingPostgres(databaseUrl);
    console.log(`Postgres is reachable. app_state has ${count} row(s).`);
    return;
  }

  if (supabaseUrl && serviceRole) {
    const count = await pingSupabase(supabaseUrl, serviceRole);
    console.log(`Supabase is reachable. app_state has ${count} row(s).`);
    return;
  }

  console.error(`
No database is configured yet.

1. Create a free project at https://supabase.com/dashboard
2. Open Project Settings → Database → Connection string → URI
   Copy it into .env.local as DATABASE_URL, then run this command again.

   Or, if you only have API keys:
   - Project Settings → API → Project URL → SUPABASE_URL
   - Project Settings → API → service_role → SUPABASE_SERVICE_ROLE_KEY
   - SQL editor → paste supabase/setup.sql → Run
`);
  process.exit(1);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
