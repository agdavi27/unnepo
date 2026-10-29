-- Resume-first onboarding (Phase 3).
--
-- The student profile lives in application_profiles.data under the "student" key, next to the
-- older flat fields, so the app works with or without this migration. This adds a completeness
-- column that Postgres keeps up to date from that JSON, for the admin page and for queries.
-- It changes no existing data and drops nothing.

alter table public.application_profiles
  add column if not exists completeness integer
  generated always as (coalesce((data -> 'student' ->> 'completeness')::integer, 0)) stored;

create index if not exists application_profiles_completeness_idx
  on public.application_profiles (completeness);

-- Row level security has been on since 0004. The app reads and writes these rows on the server with
-- the service role, scoped to the signed-in user, so no client-side policies are needed.
alter table public.application_profiles enable row level security;
