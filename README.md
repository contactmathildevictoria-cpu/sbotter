# Sbotter

Find companies hiring right now. Sbotter scrapes job postings (starting with Jobnet.dk), deduplicates them by employer, and lets you filter to spot lookalikes of your ideal customer.

## Stack

- **App**: Next.js 16 (App Router, `src/`), React 19, Tailwind v4, shadcn/ui
- **i18n**: next-intl (Danish default, English prefixed)
- **Database / auth**: Supabase (`@supabase/ssr`)
- **Scraping**: Apify + Crawlee (`apify-actors/jobnet/`)
- **Payments** (placeholder, not wired): Stripe

## Local setup

### 1. Configure env

```bash
cp .env.example .env.local
# Fill in NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY,
# SUPABASE_SERVICE_ROLE_KEY (from your Supabase project Settings → API),
# and APIFY_WEBHOOK_SECRET (any random ~32-char string;
# generate one with `openssl rand -hex 32`).
```

### 2. Provision the Supabase database

```bash
# Install the Supabase CLI: https://supabase.com/docs/guides/cli
# Either link to a hosted project:
supabase link --project-ref <your-project-ref>
supabase db push

# …or run a local stack (Docker required):
supabase start
supabase migration up
```

### 3. Run the app

```bash
npm install
npm run dev
# → http://localhost:3000
```

### 4. Ingest some sample data

With the dev server running, in another shell:

```bash
BODY=$(cat apify-actors/jobnet/fixtures/sample-payload.json)
SIG=$(echo -n "$BODY" | openssl dgst -sha256 -hmac "$APIFY_WEBHOOK_SECRET" | awk '{print $2}')
curl -X POST http://localhost:3000/api/ingest/apify \
  -H "content-type: application/json" \
  -H "x-sbotter-signature: $SIG" \
  --data-binary "$BODY"
```

Sign up at <http://localhost:3000/signup>, log in, and visit `/leads` — you should see three deduplicated companies and five job postings.

## Repository layout

```
src/                       Next.js app
  app/[locale]/            i18n-wrapped routes
  app/api/                 webhooks + auth callback
  components/              UI (ui/, leads/, auth/, shell/)
  lib/                     env, supabase, leads, ingest, i18n, plans
  messages/                next-intl strings
  types/                   database types
supabase/migrations/       SQL schema (one file)
apify-actors/jobnet/       Crawlee Actor scaffold + fixtures
```

## Conventions

See [AGENTS.md](./AGENTS.md).
