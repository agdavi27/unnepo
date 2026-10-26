-- One document for the application store. The server updates it with a version check
-- so two serverless instances cannot overwrite each other.
-- Apply in the Supabase SQL editor if you use SUPABASE_URL without DATABASE_URL.
-- A direct Postgres connection (DATABASE_URL) creates this table on its own.

create table if not exists app_state (
  id text primary key,
  data jsonb not null,
  version bigint not null default 0
);

alter table app_state enable row level security;
