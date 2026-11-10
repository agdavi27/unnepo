-- Connected Gmail accounts, so Unnepo reads job emails on its own instead of the student forwarding them.
-- Adds one new table only. Nothing existing is dropped or changed. Run once in the Supabase SQL editor. Safe to run again.
--
-- gmail_connections: one row per student. refresh_token is encrypted by the server. status turns "expired" when
-- Google stops accepting the token, and the student is asked to connect again.

create table if not exists public.gmail_connections (
  user_id text primary key,
  email text not null,
  refresh_token text not null,
  status text not null default 'active',
  last_synced_at timestamptz,
  last_error text,
  created_at timestamptz not null default now()
);

-- Reached only with the server's service-role key. Row level security with no policies keeps the anon key out.
alter table public.gmail_connections enable row level security;
