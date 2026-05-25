# Sbotter — Indeed (DK) Actor

Scrapes job postings from [dk.indeed.com](https://dk.indeed.com) and ships them
to Sbotter's ingest webhook with `?source=indeed`.

## Status

**Scaffold + fixture mode complete; live scrape handler is a stub pending
reconnaissance.** Indeed is the hardest source — heavily JS-rendered and
aggressively anti-bot. Expect to iterate on the scrape handler.

## Modes

- `fixture` — push `fixtures/sample-items.json` (no network).
- `scrape` — crawl dk.indeed.com (Playwright + proxy). **Not yet implemented** —
  see the recon TODO in `src/routes.ts`.

## Recon checklist

1. Inspect `dk.indeed.com/jobs?q=&l=Danmark` result cards: `jk=`, title, company,
   location, snippet. Click through for the full description.
2. `externalId` = the `jk` job key (stable across pages).
3. Parse relative dates ("Active 3 days ago", "30+ days ago", "I dag") via
   `normalizeDate`.
4. Anti-bot: realistic User-Agent, random 2–5s delays, residential proxy; on
   CAPTCHA, skip the listing rather than crash.
5. Paginate with `&start=10,20,…` (10/page) until maxItems.

## Local run

```bash
npm install && npm run build
SBOTTER_WEBHOOK_URL='http://localhost:3000/api/ingest/apify?source=indeed' \
SBOTTER_WEBHOOK_SECRET="$APIFY_WEBHOOK_SECRET" \
  node dist/main.js
```

Shared utilities (`src/shared/`) are vendored from `apify-actors/shared/`.
