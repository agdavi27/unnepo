import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import postgres, { type Sql } from "postgres";
import { ServiceError } from "@/lib/errors";
import { emptyDatabase, type Database } from "./types";

export class VersionConflict extends Error {
  constructor() {
    super("version conflict");
    this.name = "VersionConflict";
  }
}

type RemoteKind = "postgres" | "supabase";

function postgresUrl() {
  return process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.SUPABASE_DB_URL || "";
}

function supabaseConfig() {
  const url = process.env.SUPABASE_URL || "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!url || !key) return null;
  return { url, key };
}

export function remoteKind(): RemoteKind | null {
  if (postgresUrl()) return "postgres";
  if (supabaseConfig()) return "supabase";
  return null;
}

type RemoteGlobal = {
  sql?: Sql;
  schema?: Promise<void>;
  supabase?: SupabaseClient;
};

const globalRemote = globalThis as typeof globalThis & { __unnepoRemote?: RemoteGlobal };

function remoteState() {
  if (!globalRemote.__unnepoRemote) globalRemote.__unnepoRemote = {};
  return globalRemote.__unnepoRemote;
}

function sqlClient() {
  const current = remoteState();
  if (!current.sql) {
    const url = postgresUrl();
    current.sql = postgres(url, {
      ssl: "require",
      max: 1,
      idle_timeout: 20,
      connect_timeout: 15,
      prepare: false,
      onnotice: () => {},
    });
  }
  return current.sql;
}

function supabaseClient() {
  const current = remoteState();
  if (!current.supabase) {
    const config = supabaseConfig();
    if (!config) throw new Error("Supabase is not configured.");
    current.supabase = createClient(config.url, config.key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return current.supabase;
}

async function ensurePostgres() {
  const current = remoteState();
  if (!current.schema) {
    const sql = sqlClient();
    current.schema = sql`
      create table if not exists app_state (
        id text primary key,
        data jsonb not null,
        version bigint not null default 0
      )
    `
      .then(() => undefined)
      .catch((error) => {
        current.schema = undefined;
        throw error;
      });
  }
  await current.schema;
}

function asDatabase(value: unknown): Database {
  const parsed = typeof value === "string" ? JSON.parse(value) : value;
  if (!parsed || typeof parsed !== "object") return emptyDatabase();
  return { ...emptyDatabase(), ...(parsed as Database) };
}

export async function loadRemote(): Promise<{ db: Database; version: number | null }> {
  if (remoteKind() === "postgres") {
    await ensurePostgres();
    const rows = await sqlClient()<{ data: Database; version: number | string }[]>`
      select data, version from app_state where id = 'main'
    `;
    if (!rows.length) return { db: emptyDatabase(), version: null };
    return { db: asDatabase(rows[0].data), version: Number(rows[0].version) };
  }

  const client = supabaseClient();
  const { data, error } = await client.from("app_state").select("data, version").eq("id", "main").maybeSingle();
  if (error) throw missingTable(error);
  if (!data) return { db: emptyDatabase(), version: null };
  return { db: asDatabase(data.data), version: Number(data.version) };
}

export async function saveRemote(db: Database, version: number | null) {
  if (remoteKind() === "postgres") {
    await ensurePostgres();
    const sql = sqlClient();
    if (version === null) {
      try {
        await sql`insert into app_state (id, data, version) values ('main', ${sql.json(db as unknown as Record<string, string>)}, 1)`;
        return;
      } catch (error) {
        if ((error as { code?: string }).code === "23505") throw new VersionConflict();
        throw error;
      }
    }
    const rows = await sql<{ version: number }[]>`
      update app_state
      set data = ${sql.json(db as unknown as Record<string, string>)}, version = version + 1
      where id = 'main' and version = ${version}
      returning version
    `;
    if (!rows.length) throw new VersionConflict();
    return;
  }

  const client = supabaseClient();
  if (version === null) {
    const { error } = await client.from("app_state").insert({ id: "main", data: db, version: 1 });
    if (error) {
      if (error.code === "23505") throw new VersionConflict();
      throw missingTable(error);
    }
    return;
  }
  const { data, error } = await client
    .from("app_state")
    .update({ data: db, version: version + 1 })
    .eq("id", "main")
    .eq("version", version)
    .select("version");
  if (error) throw missingTable(error);
  if (!data?.length) throw new VersionConflict();
}

function missingTable(error: { code?: string; message?: string }) {
  if (error.code === "42P01" || error.code === "PGRST205" || /app_state/i.test(error.message || "")) {
    return new ServiceError(
      "The database is missing the app_state table. Run supabase/setup.sql in the Supabase SQL editor.",
      "database",
      500,
    );
  }
  return new ServiceError(error.message || "Could not reach the database.", "database", 500);
}
