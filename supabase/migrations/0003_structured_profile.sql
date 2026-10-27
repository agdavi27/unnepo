-- Additive profile, search, and draft tables.
-- Does not drop or alter app_state, users, billing, or existing product tables.
-- The running app stores these documents inside app_state today, so onboarding
-- works before this file is applied. Apply it in the Supabase SQL editor when
-- you want the normalized tables. The anon key has no policies, so it cannot read them.
-- The service role bypasses row level security, and the application still filters by user id.

create table if not exists profile_documents (
  user_id text primary key,
  form jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists profile_facts (
  id text primary key,
  user_id text not null,
  section text not null,
  label text not null,
  body text not null,
  source jsonb not null,
  verification_status text not null,
  approval_status text not null,
  uncertain boolean not null default false,
  inconsistency_note text,
  created_at timestamptz not null default now()
);

create index if not exists profile_facts_user_idx on profile_facts (user_id, section);

create table if not exists people_search_requests (
  id text primary key,
  user_id text not null,
  mode text not null,
  quantity integer not null,
  credits_quoted integer not null,
  prompt text not null default '',
  filters jsonb not null default '{}'::jsonb,
  status text not null,
  result_count integer not null default 0,
  credits_charged integer not null default 0,
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  unique (user_id, idempotency_key)
);

create index if not exists people_search_requests_user_idx on people_search_requests (user_id, created_at desc);

create table if not exists manual_email_drafts (
  id text primary key,
  user_id text not null,
  contact_id text not null,
  subject text not null default '',
  body text not null default '',
  student_fact_ids jsonb not null default '[]'::jsonb,
  contact_fact_ids jsonb not null default '[]'::jsonb,
  goal text not null default '',
  tone text not null default '',
  length text not null default '',
  notes text not null default '',
  status text not null default 'saved',
  created_at timestamptz not null default now()
);

create index if not exists manual_email_drafts_user_idx on manual_email_drafts (user_id, created_at desc);

alter table profile_documents enable row level security;
alter table profile_facts enable row level security;
alter table people_search_requests enable row level security;
alter table manual_email_drafts enable row level security;

-- No policies for anon or authenticated. Deny by default.
-- Service-role requests used by the app bypass RLS.
