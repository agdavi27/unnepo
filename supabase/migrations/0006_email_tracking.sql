-- Email tracking: each student's forwarding address, and what Unnepo took from each forwarded email.
-- Adds new tables only. Nothing existing is dropped or changed. Run once in the Supabase SQL editor. Safe to run again.
--
-- email_inboxes: one active address per student (the "u_..." part). Regenerating turns the old one off.
-- email_events: one row per email processed, keyed by a hash of its Message-ID so it's never processed twice.
-- Only the extracted fields and a one-line summary are kept, in data. The email's text, when kept, is in email_texts (0007).

create table if not exists public.email_inboxes (
  token text primary key,
  user_id text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists email_inboxes_user_idx on public.email_inboxes (user_id);

create table if not exists public.email_events (
  id text primary key,
  user_id text not null,
  message_key text not null,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (user_id, message_key)
);
create index if not exists email_events_user_idx on public.email_events (user_id, created_at desc);

-- Reached only with the server's service-role key. Row level security with no policies keeps the anon key out.
alter table public.email_inboxes enable row level security;
alter table public.email_events enable row level security;
