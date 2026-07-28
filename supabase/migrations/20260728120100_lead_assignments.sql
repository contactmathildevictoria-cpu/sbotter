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
