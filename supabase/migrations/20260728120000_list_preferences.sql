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
