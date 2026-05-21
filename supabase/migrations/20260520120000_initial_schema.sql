-- Spotter: initial schema
-- Profiles, deduplicated companies, job postings, scrape telemetry, saved filters.
-- RLS enabled on all tables. Companies/jobs are world-readable to authenticated users;
-- writes are restricted to the service role (used by the Apify webhook).

set check_function_bodies = off;

-- ============================================================
-- Extensions
-- ============================================================
create extension if not exists "pgcrypto" with schema "extensions";

-- ============================================================
-- Enums
-- ============================================================
do $$
begin
  if not exists (select 1 from pg_type where typname = 'plan_tier') then
    create type public.plan_tier as enum ('free', 'pro', 'enterprise');
  end if;
end $$;

-- ============================================================
-- Helper: updated_at trigger
-- ============================================================
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ============================================================
-- profiles (1:1 with auth.users)
-- ============================================================
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text,
  plan public.plan_tier not null default 'free',
  stripe_customer_id text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists set_profiles_updated_at on public.profiles;
create trigger set_profiles_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

-- Auto-provision a profile row when a new auth user is created.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, new.raw_user_meta_data ->> 'full_name')
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- ============================================================
-- data_sources (registry)
-- ============================================================
create table if not exists public.data_sources (
  id text primary key,
  name text not null,
  base_url text not null,
  country text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists set_data_sources_updated_at on public.data_sources;
create trigger set_data_sources_updated_at
before update on public.data_sources
for each row execute function public.set_updated_at();

-- ============================================================
-- companies (deduplicated employer entity)
-- ============================================================
create table if not exists public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  website text,
  domain text,
  cvr text,
  location_city text,
  location_region text,
  country text,
  industry text,
  size_bucket text,
  description text,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  open_jobs_count integer not null default 0,
  enrichment jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists companies_slug_idx on public.companies (slug);
create index if not exists companies_cvr_idx on public.companies (cvr) where cvr is not null;
create index if not exists companies_domain_idx on public.companies (domain) where domain is not null;
create index if not exists companies_location_city_idx on public.companies (location_city);
create index if not exists companies_country_idx on public.companies (country);
create index if not exists companies_open_jobs_count_idx on public.companies (open_jobs_count desc);
create index if not exists companies_last_seen_at_idx on public.companies (last_seen_at desc);
create index if not exists companies_name_trgm_idx on public.companies using gin (name gin_trgm_ops);

-- pg_trgm for company-name search; safe if already enabled.
create extension if not exists "pg_trgm" with schema "extensions";

drop trigger if exists set_companies_updated_at on public.companies;
create trigger set_companies_updated_at
before update on public.companies
for each row execute function public.set_updated_at();

-- ============================================================
-- job_postings
-- ============================================================
create table if not exists public.job_postings (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  source_id text not null references public.data_sources(id) on delete restrict,
  external_id text not null,
  title text not null,
  description text,
  category text,
  location_city text,
  location_region text,
  country text,
  url text not null,
  posted_at timestamptz,
  expires_at timestamptz,
  is_active boolean not null default true,
  raw jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source_id, external_id)
);

create index if not exists job_postings_company_id_idx on public.job_postings (company_id);
create index if not exists job_postings_posted_at_idx on public.job_postings (posted_at desc);
create index if not exists job_postings_category_idx on public.job_postings (category);
create index if not exists job_postings_location_city_idx on public.job_postings (location_city);
create index if not exists job_postings_is_active_idx on public.job_postings (is_active) where is_active;
create index if not exists job_postings_fts_idx
  on public.job_postings using gin (
    to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(description, ''))
  );

drop trigger if exists set_job_postings_updated_at on public.job_postings;
create trigger set_job_postings_updated_at
before update on public.job_postings
for each row execute function public.set_updated_at();

-- Keep companies.open_jobs_count in sync with active job postings.
create or replace function public.recount_company_open_jobs()
returns trigger
language plpgsql
as $$
declare
  affected_ids uuid[];
begin
  if tg_op = 'INSERT' then
    affected_ids := array[new.company_id];
  elsif tg_op = 'DELETE' then
    affected_ids := array[old.company_id];
  else
    affected_ids := array[new.company_id];
    if new.company_id is distinct from old.company_id then
      affected_ids := array_append(affected_ids, old.company_id);
    end if;
  end if;

  update public.companies c
  set open_jobs_count = (
    select count(*) from public.job_postings j
    where j.company_id = c.id and j.is_active = true
  )
  where c.id = any(affected_ids);

  return coalesce(new, old);
end;
$$;

drop trigger if exists recount_company_open_jobs_trigger on public.job_postings;
create trigger recount_company_open_jobs_trigger
after insert or update or delete on public.job_postings
for each row execute function public.recount_company_open_jobs();

-- ============================================================
-- scrape_runs (operational telemetry; service role only)
-- ============================================================
create table if not exists public.scrape_runs (
  id uuid primary key default gen_random_uuid(),
  source_id text not null references public.data_sources(id),
  apify_run_id text,
  apify_actor_id text,
  status text not null,
  items_received integer not null default 0,
  companies_upserted integer not null default 0,
  jobs_upserted integer not null default 0,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  error jsonb
);

create index if not exists scrape_runs_started_at_idx on public.scrape_runs (started_at desc);

-- ============================================================
-- saved_filters
-- ============================================================
create table if not exists public.saved_filters (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  view text not null check (view in ('companies', 'jobs')),
  filters jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists saved_filters_user_id_idx on public.saved_filters (user_id);

-- ============================================================
-- RLS
-- ============================================================
alter table public.profiles enable row level security;
alter table public.data_sources enable row level security;
alter table public.companies enable row level security;
alter table public.job_postings enable row level security;
alter table public.scrape_runs enable row level security;
alter table public.saved_filters enable row level security;

-- profiles: user can read/update their own row
drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own" on public.profiles
  for select to authenticated using (auth.uid() = id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles
  for update to authenticated using (auth.uid() = id) with check (auth.uid() = id);

-- data_sources: any authenticated user can read
drop policy if exists "data_sources_select_authenticated" on public.data_sources;
create policy "data_sources_select_authenticated" on public.data_sources
  for select to authenticated using (true);

-- companies: any authenticated user can read
drop policy if exists "companies_select_authenticated" on public.companies;
create policy "companies_select_authenticated" on public.companies
  for select to authenticated using (true);

-- job_postings: any authenticated user can read
drop policy if exists "job_postings_select_authenticated" on public.job_postings;
create policy "job_postings_select_authenticated" on public.job_postings
  for select to authenticated using (true);

-- scrape_runs: service role only (no policy = no access for anon/authenticated)

-- saved_filters: user manages their own rows
drop policy if exists "saved_filters_select_own" on public.saved_filters;
create policy "saved_filters_select_own" on public.saved_filters
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists "saved_filters_insert_own" on public.saved_filters;
create policy "saved_filters_insert_own" on public.saved_filters
  for insert to authenticated with check (auth.uid() = user_id);

drop policy if exists "saved_filters_update_own" on public.saved_filters;
create policy "saved_filters_update_own" on public.saved_filters
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "saved_filters_delete_own" on public.saved_filters;
create policy "saved_filters_delete_own" on public.saved_filters
  for delete to authenticated using (auth.uid() = user_id);

-- ============================================================
-- Seed: initial data source
-- ============================================================
insert into public.data_sources (id, name, base_url, country, active)
values ('jobnet', 'Jobnet.dk', 'https://job.jobnet.dk', 'DK', true)
on conflict (id) do nothing;
