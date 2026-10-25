-- Unnepo production schema. Apply with the Supabase SQL editor or CLI.
-- The Next.js server uses the service role and enforces user scope in code.
-- RLS denies the anon and authenticated roles so a leaked anon key cannot read rows.

create extension if not exists pgcrypto;

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  email_normalized text not null unique,
  password_hash text,
  name text not null,
  school_email_verified_at timestamptz,
  auth_provider text not null default 'password',
  created_at timestamptz not null default now(),
  referral_code text not null unique,
  referred_by_user_id uuid references users(id),
  onboarding_step text not null default 'profile',
  role text not null default 'student',
  deleted_at timestamptz,
  demo_user boolean not null default false
);

create table if not exists sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table if not exists verify_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  purpose text not null,
  token_hash text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists profiles (
  user_id uuid primary key references users(id) on delete cascade,
  name text not null,
  school text not null default '',
  major text not null default '',
  graduation_year text not null default '',
  bio text not null default '',
  avatar_path text,
  updated_at timestamptz not null default now()
);

create table if not exists career_goals (
  user_id uuid primary key references users(id) on delete cascade,
  roles text[] not null default '{}',
  industries text[] not null default '{}',
  locations text[] not null default '{}',
  companies text[] not null default '{}',
  updated_at timestamptz not null default now()
);

create table if not exists resumes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  file_name text not null,
  mime text not null,
  byte_size integer not null,
  sha256 text not null,
  storage_path text not null,
  text_content text not null default '',
  created_at timestamptz not null default now(),
  unique (user_id, sha256)
);

create table if not exists resume_facts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  resume_id uuid not null references resumes(id) on delete cascade,
  category text not null,
  label text not null,
  detail text not null,
  source_excerpt text not null,
  edited boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists credit_accounts (
  user_id uuid primary key references users(id) on delete cascade,
  balance integer not null default 0,
  reserved integer not null default 0,
  purchased_balance integer not null default 0,
  allowance_balance integer not null default 0,
  included_allowance integer not null default 25,
  plan text not null default 'free',
  updated_at timestamptz not null default now(),
  check (balance >= 0),
  check (reserved >= 0),
  check (purchased_balance >= 0),
  check (allowance_balance >= 0)
);

create table if not exists credit_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  entry_type text not null,
  amount integer not null,
  bucket text not null,
  idempotency_key text not null unique,
  reference_type text,
  reference_id text,
  demo boolean not null default false,
  note text,
  created_at timestamptz not null default now()
);

create unique index if not exists credit_ledger_signup_once
  on credit_ledger (user_id)
  where entry_type = 'signup_grant';

create table if not exists credit_reservations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  contact_id text not null,
  amount integer not null,
  allowance_part integer not null,
  purchased_part integer not null,
  status text not null,
  idempotency_key text not null unique,
  result jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists contacts (
  id text primary key,
  external_id text not null,
  provider text not null,
  full_name text not null,
  first_name text not null,
  last_name text not null,
  title text not null,
  company text not null,
  company_domain text,
  location text not null default '',
  school text,
  profile_url text,
  email text,
  email_status text not null default 'unknown',
  phone text,
  phone_status text not null default 'unknown',
  tags text[] not null default '{}',
  seniority text,
  department text,
  industry text,
  company_size text,
  interests text[] not null default '{}',
  previous_roles text[] not null default '{}',
  achievements text[] not null default '{}',
  public_posts jsonb not null default '[]',
  verified_mutuals text[] not null default '{}',
  shareable boolean not null default false,
  license_note text not null,
  data_source text not null,
  fetched_at timestamptz not null default now(),
  expires_at timestamptz,
  cost_cents numeric not null default 0,
  cost_estimated boolean not null default true,
  unique (provider, external_id)
);

create table if not exists searches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  filters jsonb not null,
  result_count integer not null,
  provider text not null,
  cost_cents numeric not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists saved_contacts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  contact_id text not null references contacts(id),
  status text not null default 'not_contacted',
  notes text not null default '',
  follow_up_at timestamptz,
  list_name text not null default 'All',
  credit_charged boolean not null default false,
  unlocked_at timestamptz not null default now(),
  opt_out boolean not null default false,
  auto_follow_up_authorized boolean not null default false,
  updated_at timestamptz not null default now(),
  unique (user_id, contact_id)
);

create table if not exists mailboxes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  provider text not null,
  email text not null,
  access_token_encrypted text,
  refresh_token_encrypted text,
  expires_at timestamptz,
  connected_at timestamptz not null default now(),
  unique (user_id, provider)
);

create table if not exists email_drafts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  saved_contact_id uuid not null references saved_contacts(id) on delete cascade,
  subject text not null,
  body text not null,
  tone text not null,
  purpose text not null,
  selected_fact_ids text[] not null default '{}',
  attach_resume boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists email_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  saved_contact_id uuid not null references saved_contacts(id) on delete cascade,
  direction text not null,
  provider text not null,
  provider_message_id text,
  provider_thread_id text,
  subject text not null,
  body text not null,
  status text not null,
  delivery_confirmed boolean not null default false,
  idempotency_key text not null unique,
  classification text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

create table if not exists follow_ups (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  saved_contact_id uuid not null references saved_contacts(id) on delete cascade,
  due_at timestamptz not null,
  note text not null,
  status text not null default 'open',
  auto_send boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists ai_generations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  purpose text not null,
  model text not null,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  cost_cents numeric not null default 0,
  estimated boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists provider_usage (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete set null,
  provider text not null,
  operation text not null,
  success boolean not null,
  latency_ms integer not null,
  cost_cents numeric not null default 0,
  estimated boolean not null default true,
  error text,
  created_at timestamptz not null default now()
);

create index if not exists provider_usage_created_idx on provider_usage (created_at);

create table if not exists payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id),
  stripe_event_id text unique,
  stripe_checkout_id text,
  stripe_payment_intent text,
  amount_cents integer not null,
  currency text not null default 'usd',
  kind text not null,
  status text not null,
  credits_granted integer not null default 0,
  demo boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id),
  stripe_subscription_id text not null unique,
  status text not null,
  price_cents integer not null,
  current_period_end timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists referrals (
  id uuid primary key default gen_random_uuid(),
  referrer_id uuid not null references users(id),
  referred_user_id uuid not null unique references users(id),
  code text not null,
  status text not null,
  reason text,
  created_at timestamptz not null default now(),
  rewarded_at timestamptz
);

create table if not exists jobs (
  id text primary key,
  external_id text not null,
  provider text not null,
  title text not null,
  company text not null,
  location text not null,
  posted_at timestamptz not null,
  url text not null,
  industry text,
  data_source text not null,
  description text not null default '',
  unique (provider, external_id)
);

create table if not exists saved_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  job_id text not null references jobs(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (user_id, job_id)
);

create table if not exists audit_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  action text not null,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create table if not exists analytics_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  name text not null,
  properties jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create table if not exists webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  event_id text not null,
  created_at timestamptz not null default now(),
  unique (provider, event_id)
);

create table if not exists idempotency_keys (
  key text primary key,
  status text not null,
  result jsonb,
  created_at timestamptz not null default now()
);

create table if not exists oauth_states (
  id uuid primary key default gen_random_uuid(),
  state text not null unique,
  provider text not null,
  user_id uuid,
  purpose text not null,
  redirect_origin text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

alter table users enable row level security;
alter table sessions enable row level security;
alter table verify_tokens enable row level security;
alter table profiles enable row level security;
alter table career_goals enable row level security;
alter table resumes enable row level security;
alter table resume_facts enable row level security;
alter table credit_accounts enable row level security;
alter table credit_ledger enable row level security;
alter table credit_reservations enable row level security;
alter table contacts enable row level security;
alter table searches enable row level security;
alter table saved_contacts enable row level security;
alter table mailboxes enable row level security;
alter table email_drafts enable row level security;
alter table email_messages enable row level security;
alter table follow_ups enable row level security;
alter table ai_generations enable row level security;
alter table provider_usage enable row level security;
alter table payments enable row level security;
alter table subscriptions enable row level security;
alter table referrals enable row level security;
alter table jobs enable row level security;
alter table saved_jobs enable row level security;
alter table audit_logs enable row level security;
alter table analytics_events enable row level security;
alter table webhook_events enable row level security;
alter table idempotency_keys enable row level security;
alter table oauth_states enable row level security;

-- No policies for anon/authenticated. The service role bypasses RLS.
-- Create a private Storage bucket named "resumes" in the Supabase dashboard.

create or replace function reserve_credit(p_user_id uuid, p_contact_id text, p_key text, p_amount integer)
returns jsonb
language plpgsql
as $$
declare
  acct credit_accounts%rowtype;
  existing credit_reservations%rowtype;
  allowance_part integer;
  purchased_part integer;
  new_id uuid;
begin
  select * into existing from credit_reservations where idempotency_key = p_key;
  if found and existing.status = 'finalized' then
    return jsonb_build_object('kind', 'replay', 'reservation_id', existing.id, 'result', existing.result);
  end if;
  if found and existing.status = 'reserved' then
    return jsonb_build_object('kind', 'in_progress', 'reservation_id', existing.id);
  end if;

  select * into acct from credit_accounts where user_id = p_user_id for update;
  if acct.user_id is null then
    insert into credit_accounts (user_id) values (p_user_id) returning * into acct;
  end if;
  if acct.balance < p_amount then
    return jsonb_build_object('kind', 'insufficient', 'balance', acct.balance);
  end if;

  allowance_part := least(acct.allowance_balance, p_amount);
  purchased_part := p_amount - allowance_part;
  update credit_accounts
    set balance = balance - p_amount,
        reserved = reserved + p_amount,
        allowance_balance = allowance_balance - allowance_part,
        purchased_balance = purchased_balance - purchased_part,
        updated_at = now()
    where user_id = p_user_id;

  if found and existing.status = 'released' then
    update credit_reservations
      set status = 'reserved', amount = p_amount, allowance_part = allowance_part,
          purchased_part = purchased_part, contact_id = p_contact_id, result = null, updated_at = now()
      where id = existing.id;
    return jsonb_build_object('kind', 'reserved', 'reservation_id', existing.id);
  end if;

  new_id := gen_random_uuid();
  insert into credit_reservations (id, user_id, contact_id, amount, allowance_part, purchased_part, status, idempotency_key)
  values (new_id, p_user_id, p_contact_id, p_amount, allowance_part, purchased_part, 'reserved', p_key);
  return jsonb_build_object('kind', 'reserved', 'reservation_id', new_id);
end;
$$;
