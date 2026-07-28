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
