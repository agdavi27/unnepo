-- Unnepo V1: job applications, the people found for each one, and the reusable application profile.
-- Adds new tables only. Nothing existing is dropped or changed, and app_state stays as it is.
-- Run once in the Supabase SQL editor. Safe to run again.

create table if not exists public.application_profiles (
  user_id text primary key,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.job_applications (
  id text primary key,
  user_id text not null,
  job_key text not null,
  job_url text not null,
  ats text not null,
  title text not null default '',
  company text not null default '',
  company_domain text,
  department text,
  location text,
  description text not null default '',
  requirements jsonb not null default '[]'::jsonb,
  application_url text,
  posted_recruiter jsonb,
  status text not null default 'extracted',
  status_message text not null default '',
  questions jsonb not null default '[]'::jsonb,
  browser_session_id text,
  fill_report jsonb,
  confirmation jsonb,
  submitted_at timestamptz,
  contacts_status text not null default 'idle',
  contacts_message text not null default '',
  charged boolean not null default false,
  attempts integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, job_key)
);
create index if not exists job_applications_user_idx on public.job_applications (user_id, created_at desc);

create table if not exists public.application_contacts (
  id text primary key,
  application_id text not null references public.job_applications(id) on delete cascade,
  user_id text not null,
  rank integer not null,
  role text not null,
  name text not null,
  title text not null default '',
  email text,
  email_source text,
  relevance text not null default '',
  linkedin_url text,
  photo_url text,
  outreach_status text not null default 'not_contacted',
  email_subject text,
  email_body text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (application_id, name)
);
create index if not exists application_contacts_app_idx on public.application_contacts (application_id, rank);
create index if not exists application_contacts_user_idx on public.application_contacts (user_id);

-- The app reaches these tables only with the server's service-role key. Row level security with no
-- policies keeps them closed to the public anon key.
alter table public.application_profiles enable row level security;
alter table public.job_applications enable row level security;
alter table public.application_contacts enable row level security;
