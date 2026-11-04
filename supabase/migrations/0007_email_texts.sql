-- The text of emails about a job, so a student can read them on that job.
-- Adds one new table only. Nothing existing is dropped or changed. Run once in the Supabase SQL editor. Safe to run again.
--
-- email_texts: one row per email, the same id as its row in email_events. data holds the sender, subject and
-- text, encrypted by the server. Emails that aren't about a job are never saved here.

create table if not exists public.email_texts (
  event_id text primary key,
  user_id text not null,
  data text not null,
  created_at timestamptz not null default now()
);
create index if not exists email_texts_user_idx on public.email_texts (user_id);

-- Reached only with the server's service-role key. Row level security with no policies keeps the anon key out.
alter table public.email_texts enable row level security;
