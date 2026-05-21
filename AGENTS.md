<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Spotter

Spotter is a lead-generation platform. It scrapes job listings from Danish and international sources (starting with Jobnet.dk), normalizes them into deduplicated **companies** with their open **job_postings**, and lets users filter to find companies matching their ideal customer profile ("Copenhagen tech companies hiring sales", "everyone who posted within the last 7 days", etc.).

This file is the conventions reference. Read it before writing code in this repo.

## Architecture

```
Apify Actor (Crawlee, in apify-actors/jobnet/) ─POST─▶ /api/ingest/apify
                                                          │
                                                          ▼
                                                 Supabase service-role client
                                                          │
                                          upserts companies + job_postings
                                                          │
        Next.js App Router (src/app/[locale]/) ◀─ RLS read by authenticated users
```

- **Tech**: Next.js 16 (App Router, RSC, `src/` layout), React 19, Tailwind v4, shadcn/ui (`new-york`, neutral), `@supabase/ssr`, next-intl v4, zod v4.
- **Database**: Supabase Postgres. Schema lives in `supabase/migrations/`. Apply with `supabase db push` (linked project) or `supabase migration up` (local stack).
- **Account model**: individual users (no orgs in v1). `profiles` is 1:1 with `auth.users`.

## Conventions

### Supabase clients (`src/lib/supabase/`)

| File         | When to use                                                                                              |
| ------------ | -------------------------------------------------------------------------------------------------------- |
| `server.ts`  | Server Components and Server Actions. Respects RLS as the logged-in user.                                 |
| `browser.ts` | Client components that need to subscribe to realtime or call `auth` methods directly. Respects RLS.       |
| `service.ts` | Server-only. Bypasses RLS. Only use inside trusted contexts (e.g. ingest webhook AFTER signature verify). |

### Server actions

Live in `src/lib/<feature>/actions.ts` with `"use server"` at the top. Validate input with zod. Return shape: `{ ok: true; data?: T } | { ok: false; error: string }`. Use `redirect()` for the happy path; never throw to the client.

### Auth

- Email + password only (v1). Magic link / OAuth deferred.
- `middleware.ts` chains next-intl with Supabase session refresh + redirects unauthenticated users on gated paths.
- The `(app)` route group does a second-layer `getUser()` check and redirects to `/login` to defend against any middleware bypass.
- Public routes: `/`, `/login`, `/signup`, `/auth/*`, `/api/*`.

### i18n

- next-intl v4 with `da` (default, no URL prefix) and `en` (prefixed `/en/...`).
- Routing: `src/lib/i18n/routing.ts`. Navigation helpers: `src/lib/i18n/navigation.ts`. Request config: `src/lib/i18n/request.ts`.
- Always import `Link`, `useRouter`, `usePathname`, `redirect` from `@/lib/i18n/navigation` — never from `next/navigation` directly in user-facing UI.
- Strings live in `src/messages/{da,en}.json`. Server: `await getTranslations("Namespace")`. Client: `useTranslations("Namespace")`.

### Filters → URL state

The leads dashboard encodes its filter state in URL search params (`q`, `city`, `country`, `category`, `since`, `min_open_jobs`, `sources`, `page`). The single source of truth lives in `src/lib/leads/filters.ts` (`parseFiltersFromSearchParams`, `filtersToSearchString`). Pages are React Server Components that build Supabase queries from the parsed filters. The `FilterPanel` client component reads/writes URL via `router.replace`.

### Ingest pipeline (`src/lib/ingest/`)

- `normalize.ts` — converts a raw Jobnet item into our unified shape with a zod schema. Reuse this shape when adding new sources; only the per-source normalizer should change.
- `apify.ts` — the upsert pipeline. Dedups companies by `cvr ?? domain ?? slug`. Upserts job postings by `(source_id, external_id)`. Marks job postings absent from the current run as `is_active = false`. Records counts in `scrape_runs`.
- `route.ts` (the webhook) — verifies an HMAC-SHA256 signature in `x-spotter-signature` against `APIFY_WEBHOOK_SECRET`. NEVER touch the request body before verifying.

### Plans

`src/lib/plans.ts` defines `PLAN_LIMITS` for `free` / `pro` / `enterprise`. The `profiles.plan` column exists today but is not enforced. When adding gates, import `PLAN_LIMITS[user.plan].<limit>` rather than hard-coding values.

### Other rules

- **Env access**: lazy getters in `src/lib/env.ts` — never read `process.env` elsewhere in app code.
- **Updated_at**: every mutable table has a `set_updated_at` trigger. Don't set it manually.
- **Migrations**: filename format `YYYYMMDDHHMMSS_description.sql`. One concept per migration.

## Things deliberately not built yet

These are not bugs — they are explicit non-goals for the foundation iteration:

- Stripe checkout / webhook (placeholder env vars only; `profiles.plan` is read-only).
- Claude enrichment of companies (the `enrichment` jsonb column is reserved for this).
- Alerts (Pro feature).
- API access (Enterprise feature).
- Saved filters UI (the table exists in the schema; no UI yet).
- Multi-tenant orgs (the user explicitly chose individual accounts for v1).
- Production-grade Jobnet selectors (the Actor scaffold uses best-guess selectors; expect to tune them before scheduling daily runs).
