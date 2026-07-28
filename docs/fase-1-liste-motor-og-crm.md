# Sbotter 2.0 — Fase 1: Daglig liste-motor + CRM

Denne plan dækker paradigmeskiftet: fra én stor søgbar pulje til en **frisk daglig leadliste pr. bruger** med **CRM-status, rating og noter** ovenpå. Den bygger videre på den eksisterende datamodel (`companies`, `job_postings`, enrichment-kolonner) og ingest-pipeline — intet af det rives ned.

Nye kilder (LinkedIn, kommunale sider) og flytning af kontaktperson til job-niveau hører til **fase 2** og er markeret undervejs, men bygges ikke her.

---

## 1. Datamodel (migrations)

Filnavnsformat følger repoets konvention: `YYYYMMDDHHMMSS_beskrivelse.sql`, ét koncept pr. migration. Alle nye tabeller har RLS slået til, hvor brugeren kun ser sine egne rækker.

### 1.1 `20260728120000_list_preferences.sql`

Brugerens indstillinger for den daglige liste.

```sql
create table if not exists public.list_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  daily_target integer not null default 50 check (daily_target between 1 and 200),
  trash_max integer not null default 10 check (trash_max between 0 and 50),
  follow_up_days integer not null default 7 check (follow_up_days between 1 and 90),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.list_preferences enable row level security;

create policy "list_preferences_rw_own" on public.list_preferences
  for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
```

Tilføj `set_updated_at`-trigger (samme mønster som de øvrige tabeller). Provisionér en default-række i `handle_new_user()` (udvid den eksisterende funktion), så hver bruger altid har præferencer.

### 1.2 `20260728120100_lead_assignments.sql`

Kernen i CRM'et. Én række = ét lead på én brugers liste. Bærer status, rating, note og opfølgningsdato.

```sql
do $$
begin
  if not exists (select 1 from pg_type where typname = 'lead_status') then
    create type public.lead_status as enum
      ('new', 'contacted', 'no_pickup', 'meeting', 'won', 'lost');
  end if;
end $$;

create table if not exists public.lead_assignments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  -- Fase 2: peger på det konkrete job/kontaktperson når kontaktperson flyttes til job-niveau
  job_posting_id uuid references public.job_postings(id) on delete set null,
  list_date date not null default current_date,
  origin text not null default 'fresh' check (origin in ('fresh', 'recycled', 'fill')),
  status public.lead_status not null default 'new',
  rating smallint check (rating between 1 and 10),
  note text,
  follow_up_at date,
  in_trash boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Samme lead må aldrig gives til samme bruger to gange (dublet-sikring pr. bruger)
  unique (user_id, company_id)
);

create index if not exists lead_assignments_user_date_idx
  on public.lead_assignments (user_id, list_date desc);
create index if not exists lead_assignments_user_status_idx
  on public.lead_assignments (user_id, status);
create index if not exists lead_assignments_followup_idx
  on public.lead_assignments (user_id, follow_up_at)
  where in_trash = true;

alter table public.lead_assignments enable row level security;

create policy "lead_assignments_rw_own" on public.lead_assignments
  for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
```

`unique (user_id, company_id)` er dublet-motoren: et firma man allerede har på listen (eller i skraldespanden) bliver aldrig skrabet ind igen til samme bruger. Tilføj `set_updated_at`-trigger.

**Skraldespand-logik:** `in_trash = true` betyder ude af den friske pulje. `status = 'no_pickup'` sætter `follow_up_at = current_date + follow_up_days` og `in_trash = true`. Motoren løfter dem op igen når `follow_up_at <= current_date`.

### 1.3 `20260728120200_exclusions.sql`

Egne kunder og fravalgte brancher.

```sql
create table if not exists public.excluded_companies (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  -- Fritekst-navn brugeren indtaster; matches mod companies.name (normaliseret)
  name text not null,
  name_normalized text not null,
  cvr text,
  domain text,
  created_at timestamptz not null default now()
);

create index if not exists excluded_companies_user_idx
  on public.excluded_companies (user_id);
create index if not exists excluded_companies_norm_idx
  on public.excluded_companies (user_id, name_normalized);

create table if not exists public.blocked_industries (
  user_id uuid not null references auth.users(id) on delete cascade,
  -- CVR-branchekode (companies.cvr_industry_code) ELLER en intern kategori
  industry_code integer,
  industry_label text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, industry_label)
);

alter table public.excluded_companies enable row level security;
alter table public.blocked_industries enable row level security;

create policy "excluded_companies_rw_own" on public.excluded_companies
  for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "blocked_industries_rw_own" on public.blocked_industries
  for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
```

`name_normalized` genbruger `slugify()` fra `src/lib/ingest/normalize.ts`, så "Arla", "Arla Foods" og "arla foods a/s" matcher robust. Vikarbureauer løses via `blocked_industries` (CVR-branchekoderne for "vikarbureauer" ligger i 78200-serien).

### 1.4 Lukkede firmaer

`is_bankrupt` findes allerede på `companies` (fra CVR-enrichment). Ingen migration nødvendig — motoren filtrerer bare `is_bankrupt = false`. Overvej en lille tilføjelse hvis I vil skelne konkurs vs. ophørt:

```sql
alter table public.companies
  add column if not exists is_active_business boolean not null default true;
```

---

## 2. Server-logik: den daglige liste-motor

**Fil:** `src/lib/leads/daily-list.ts` (server-only, bruger service-klienten så den kan læse på tværs af brugere ved cron-kørsel).

Funktion `generateDailyList(userId: string, date = today)`. Prioritetsrækkefølge — friskhed først, skraldespand kun som planlagt opfølgning eller nødfyld:

1. **Hent præferencer:** `daily_target` (T), `trash_max` (M), `follow_up_days`.
2. **Opfølgninger (genbrug):** rækker i `lead_assignments` hvor `user_id = X`, `in_trash = true`, `follow_up_at <= date`. Sortér ældste opfølgning først, tag maks `M`. Sæt `in_trash = false`, `status = 'new'`, `origin = 'recycled'`, `list_date = date`.
3. **Friske leads:** vælg `companies` der:
   - har mindst ét aktivt `job_posting` (`open_jobs_count >= 1`),
   - `is_bankrupt = false`,
   - **ikke** allerede findes i brugerens `lead_assignments` (dublet-sikring via `unique`),
   - **ikke** matcher `excluded_companies` (på `name_normalized`/`cvr`/`domain`),
   - **ikke** har `cvr_industry_code` i brugerens `blocked_industries`.

   Sortér nyeste `last_seen_at` først. Tag `T − (antal genbrugte)` stykker. Indsæt med `origin = 'fresh'`.
4. **Nødfyld (fallback):** hvis der stadig mangler op til T fordi skrabet var tyndt, tag ekstra fra skraldespanden (uanset `follow_up_at`), maks resten af T. `origin = 'fill'`.
5. **Idempotens:** kører motoren to gange samme dag, må den ikke lave dubletter — tjek på `list_date` + eksisterende assignments.

Returnér `{ ok: true, data: { fresh, recycled, fill, total } }`.

**Planlægning:** en scheduled task kører hver morgen (fx 06:00) og kalder motoren for hver aktiv bruger. Kan sættes op via en cron-route `src/app/api/cron/daily-list/route.ts` (samme mønster som den eksisterende `src/app/api/cron/enrich/route.ts`) beskyttet med et cron-secret.

---

## 3. Server actions (CRM-handlinger)

**Fil:** `src/lib/leads/crm-actions.ts` med `"use server"`. Zod-valideret input, returshape `{ ok: true; data?: T } | { ok: false; error: string }` — præcis som repoets konvention. Alle skriver via `server.ts`-klienten (respekterer RLS, brugeren rører kun egne rækker).

- `setLeadStatus(id, status)` — ved `no_pickup`: sæt `in_trash = true` og `follow_up_at = current_date + follow_up_days`. Ved øvrige statusser: `in_trash = false`.
- `setLeadRating(id, rating)` — `rating` 1–10, zod `.int().min(1).max(10)`.
- `setLeadNote(id, note)` — fritekst, trim, maks fx 2000 tegn.
- `addExcludedCompany(name)` / `removeExcludedCompany(id)`.
- `addBlockedIndustry(label, code?)` / `removeBlockedIndustry(...)`.
- `updateListPreferences({ dailyTarget, trashMax, followUpDays })`.

Kald `revalidatePath('/leads/today')` efter mutationer så boardet opdaterer.

---

## 4. UI

### 4.1 Ny rute — dagens liste / board

`src/app/[locale]/(app)/leads/today/page.tsx` (RSC). Henter dagens `lead_assignments` for brugeren joinet med `companies` (navn, telefon via CVR/Krak/website-fallback, kontaktperson). Bliv i `(app)`-route-gruppen så auth-tjekket arver.

Gør den til standard-landing: skift `src/app/[locale]/(app)/dashboard/page.tsx`' redirect fra `/leads` til `/leads/today`.

### 4.2 Board-komponent

`src/components/leads/lead-board.tsx` (client). Kolonner pr. status: Nye · Kontaktet · No pickup · Møde · Vundet/Tabt. Den gamle søgbare pulje (`/leads/companies`) bevares som "udforsk hele databasen".

### 4.3 Lead-kort

`src/components/leads/lead-card.tsx` (client) — jf. mockup'en ovenfor. **Synligt uden at folde ud:** firmanavn, kontaktperson, telefonnummer, rating (fx `8/10`). **Interaktivt på kortet:** rating-vælger 1–10 og et notefelt (debounced auto-save via `setLeadNote`), plus statusknapper. Telefon som `tel:`-link.

Telefonopslag genbruger fallback-kæden der allerede findes: `phone ?? website_phone ?? krak_phone`, kontaktperson `contact_person_name ?? website_contact_person ?? krak_contact_person` — altså CVR → website → Krak. (Rettet: en tidligere version af dette afsnit havde Krak før website, men den kørende kode har altid haft website først, fordi website-scraperen typisk finder den direkte kontakt hvor Krak kun har hovednummeret.) Helperen ligger i `src/lib/leads/contact.ts` og bruges af både lead-kortet, pulje-tabellen og CSV-eksporten.

### 4.4 Indstillinger

Udvid `src/app/[locale]/(app)/settings/page.tsx`: antal leads/dag, max fra skraldespand, opfølgnings-interval, liste over egne kunder (`excluded_companies`) og fravalgte brancher (`blocked_industries`).

Husk i18n: nye strenge i `src/messages/da.json` + `en.json`.

---

## 5. Rækkefølge at bygge i

1. Migrations 1.1–1.3 + udvid `handle_new_user()`.
2. `daily-list.ts` med unit-test af prioritetslogikken (frisk → genbrug → nødfyld, dublet- og eksklusionsfiltre).
3. Cron-route + scheduled task.
4. `crm-actions.ts`.
5. Board + lead-kort + ny rute.
6. Indstillingsside (præferencer, egne kunder, brancher).
7. Verifikation: seed en testbruger, kør motoren to dage i træk, bekræft friskhed, genbrug efter `follow_up_days`, og at ekskluderede firmaer/brancher aldrig dukker op.

## Fase 2 (senere)

- LinkedIn jobs-actor + kommunale actors (pr. kommune-hjemmeside med kontakt pr. job).
- Flyt kontaktperson fra `companies` til `job_postings` (scrape rette person pr. job/lokation).
- Kobl `lead_assignments.job_posting_id` til det konkrete job.
