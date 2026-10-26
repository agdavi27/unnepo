-- Paste this into the Supabase SQL editor (SQL → New query → Run).
-- This is the only table the hosted app needs to create accounts today.

create table if not exists app_state (
  id text primary key,
  data jsonb not null,
  version bigint not null default 0
);

alter table app_state enable row level security;
