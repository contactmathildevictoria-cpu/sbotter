-- Fase 1 — anvend på produktionsdatabasen.
--
-- Dette er de tre migrations fra supabase/migrations/ samlet i én fil, så de
-- kan indsættes direkte i Supabase SQL Editor uden CLI eller Docker.
--
-- Sikker at køre: alt er idempotent (create ... if not exists, drop policy før
-- create policy, guardede do $$-blokke), så en gentagen kørsel er et no-op.
-- Kør den som ÉN samlet kørsel.
--
-- Svarer nøjagtigt til `supabase db push`. Til sidst skrives migrationerne ind
-- i supabase_migrations.schema_migrations, så CLI'en er i sync bagefter.

-- ============================================================
-- 20260728120000_list_preferences.sql
-- ============================================================

-- Sbotter 2.0 / Fase 1: per-user settings for the daily lead list.
--
-- One row per user. Provisioned at signup by handle_new_user() (extended
-- below) and backfilled for users that already existed. "Every user has
-- preferences" is one concept, so the table, the hook and the backfill all
-- live in this single migration.

set check_function_bodies = off;

-- ============================================================
-- list_preferences
-- ============================================================
create table if not exists public.list_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  -- How many UNWORKED leads the engine tops the user's board up to.
  daily_target integer not null default 50 check (daily_target between 1 and 200),
  -- Global per-run budget for leads sourced from the trash (recycled + fill).
  trash_max integer not null default 10 check (trash_max between 0 and 50),
  -- Days a "no pickup" lead rests in the trash before it resurfaces.
  follow_up_days integer not null default 7 check (follow_up_days between 1 and 90),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists set_list_preferences_updated_at on public.list_preferences;
create trigger set_list_preferences_updated_at
before update on public.list_preferences
for each row execute function public.set_updated_at();

-- ============================================================
-- RLS
-- ============================================================
alter table public.list_preferences enable row level security;

drop policy if exists "list_preferences_select_own" on public.list_preferences;
create policy "list_preferences_select_own" on public.list_preferences
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists "list_preferences_insert_own" on public.list_preferences;
create policy "list_preferences_insert_own" on public.list_preferences
  for insert to authenticated with check (auth.uid() = user_id);

drop policy if exists "list_preferences_update_own" on public.list_preferences;
create policy "list_preferences_update_own" on public.list_preferences
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "list_preferences_delete_own" on public.list_preferences;
create policy "list_preferences_delete_own" on public.list_preferences
  for delete to authenticated using (auth.uid() = user_id);

-- ============================================================
-- Signup hook: every new user also gets default list preferences.
-- ============================================================
-- This trigger runs INSIDE the auth.users insert transaction, so a failure
-- here breaks signup for everyone. Both inserts use `on conflict do nothing`
-- so a re-run or a race can never raise.
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

  insert into public.list_preferences (user_id)
  values (new.id)
  on conflict (user_id) do nothing;

  return new;
end;
$$;

-- ============================================================
-- Backfill: users created before this migration.
-- ============================================================
insert into public.list_preferences (user_id)
select id from auth.users
on conflict (user_id) do nothing;

-- ============================================================
-- 20260728120100_lead_assignments.sql
-- ============================================================

-- Sbotter 2.0 / Fase 1: the CRM core.
--
-- One row = one lead on one user's board. Carries status, rating, note and
-- follow-up date. `unique (user_id, company_id)` is the dedupe engine: a
-- company the user has already been given — active OR in the trash — is never
-- handed to them a second time.

-- ============================================================
-- Enum
-- ============================================================
do $$
begin
  if not exists (select 1 from pg_type where typname = 'lead_status') then
    create type public.lead_status as enum
      ('new', 'contacted', 'no_pickup', 'meeting', 'won', 'lost');
  end if;
end $$;

-- ============================================================
-- lead_assignments
-- ============================================================
create table if not exists public.lead_assignments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  -- Fase 2 hook: points at the concrete job once the contact person moves
  -- from company level to job level. Unused for now.
  job_posting_id uuid references public.job_postings(id) on delete set null,
  -- The day the engine last placed this lead on the board. Written by the
  -- engine in Europe/Copenhagen time; the default is a fallback we never rely
  -- on (Postgres runs UTC on Supabase).
  list_date date not null default current_date,
  origin text not null default 'fresh' check (origin in ('fresh', 'recycled', 'fill')),
  status public.lead_status not null default 'new',
  rating smallint check (rating between 1 and 10),
  note text,
  follow_up_at date,
  -- true = out of the fresh pool. Set by status = 'no_pickup'.
  in_trash boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, company_id)
);

create index if not exists lead_assignments_user_date_idx
  on public.lead_assignments (user_id, list_date desc);
create index if not exists lead_assignments_user_status_idx
  on public.lead_assignments (user_id, status);
-- Recycle scan: due follow-ups, oldest first.
create index if not exists lead_assignments_followup_idx
  on public.lead_assignments (user_id, follow_up_at)
  where in_trash = true;
-- Board read: every active card for a user, newest list_date first.
create index if not exists lead_assignments_user_active_idx
  on public.lead_assignments (user_id, list_date desc)
  where in_trash = false;

drop trigger if exists set_lead_assignments_updated_at on public.lead_assignments;
create trigger set_lead_assignments_updated_at
before update on public.lead_assignments
for each row execute function public.set_updated_at();

-- ============================================================
-- RLS
-- ============================================================
alter table public.lead_assignments enable row level security;

drop policy if exists "lead_assignments_select_own" on public.lead_assignments;
create policy "lead_assignments_select_own" on public.lead_assignments
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists "lead_assignments_insert_own" on public.lead_assignments;
create policy "lead_assignments_insert_own" on public.lead_assignments
  for insert to authenticated with check (auth.uid() = user_id);

drop policy if exists "lead_assignments_update_own" on public.lead_assignments;
create policy "lead_assignments_update_own" on public.lead_assignments
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "lead_assignments_delete_own" on public.lead_assignments;
create policy "lead_assignments_delete_own" on public.lead_assignments
  for delete to authenticated using (auth.uid() = user_id);

-- ============================================================
-- 20260728120200_exclusions.sql
-- ============================================================

-- Sbotter 2.0 / Fase 1: what the daily-list engine must never hand out.
--
-- Two independent opt-outs: named companies the user already serves, and
-- whole CVR industries they don't sell to.

-- ============================================================
-- excluded_companies — the user's own customers
-- ============================================================
create table if not exists public.excluded_companies (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  -- Free text as the user typed it, kept for display.
  name text not null,
  -- slugify(name) — the exact same transform that produces companies.slug,
  -- so matching is `slug = name_normalized` or `slug like name_normalized-%`.
  -- That makes "Arla" exclude "arla-foods" but not "arlandia".
  name_normalized text not null,
  cvr text,
  domain text,
  created_at timestamptz not null default now(),
  -- Makes addExcludedCompany idempotent and lets the action return a clean
  -- ALREADY_EXCLUDED instead of piling up silent duplicates.
  unique (user_id, name_normalized)
);

create index if not exists excluded_companies_user_idx
  on public.excluded_companies (user_id);

-- ============================================================
-- blocked_industries — CVR industry codes the user opts out of
-- ============================================================
-- industry_code is NOT NULL by design. A row without a code is unenforceable:
-- the engine filters on companies.cvr_industry_code, so a label-only row would
-- be a silent no-op with no feedback to the user. Groups (e.g. staffing =
-- 781000 + 782000 + 783000) are expressed as several rows sharing a label.
create table if not exists public.blocked_industries (
  user_id uuid not null references auth.users(id) on delete cascade,
  industry_code integer not null,
  industry_label text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, industry_code)
);

-- ============================================================
-- RLS
-- ============================================================
alter table public.excluded_companies enable row level security;
alter table public.blocked_industries enable row level security;

drop policy if exists "excluded_companies_select_own" on public.excluded_companies;
create policy "excluded_companies_select_own" on public.excluded_companies
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists "excluded_companies_insert_own" on public.excluded_companies;
create policy "excluded_companies_insert_own" on public.excluded_companies
  for insert to authenticated with check (auth.uid() = user_id);

drop policy if exists "excluded_companies_update_own" on public.excluded_companies;
create policy "excluded_companies_update_own" on public.excluded_companies
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "excluded_companies_delete_own" on public.excluded_companies;
create policy "excluded_companies_delete_own" on public.excluded_companies
  for delete to authenticated using (auth.uid() = user_id);

drop policy if exists "blocked_industries_select_own" on public.blocked_industries;
create policy "blocked_industries_select_own" on public.blocked_industries
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists "blocked_industries_insert_own" on public.blocked_industries;
create policy "blocked_industries_insert_own" on public.blocked_industries
  for insert to authenticated with check (auth.uid() = user_id);

drop policy if exists "blocked_industries_update_own" on public.blocked_industries;
create policy "blocked_industries_update_own" on public.blocked_industries
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "blocked_industries_delete_own" on public.blocked_industries;
create policy "blocked_industries_delete_own" on public.blocked_industries
  for delete to authenticated using (auth.uid() = user_id);

-- ============================================================
-- Bogføring: markér migrationerne som anvendt, så en senere
-- `supabase db push` ikke forsøger at køre dem igen.
-- Springes over hvis migrationstabellen ikke findes endnu.
-- ============================================================
do $$
begin
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    insert into supabase_migrations.schema_migrations (version, name)
    values
      ('20260728120000', 'list_preferences'),
      ('20260728120100', 'lead_assignments'),
      ('20260728120200', 'exclusions')
    on conflict (version) do nothing;
  end if;
end $$;

-- ============================================================
-- Kontrol: alle fire tabeller skal dukke op her.
-- ============================================================
select table_name
from information_schema.tables
where table_schema = 'public'
  and table_name in ('list_preferences','lead_assignments','excluded_companies','blocked_industries')
order by table_name;
