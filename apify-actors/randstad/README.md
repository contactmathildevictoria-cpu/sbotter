# Sbotter — Randstad (DK) Actor

Scrapes job postings from [randstad.dk](https://www.randstad.dk) and ships them
to Sbotter's ingest webhook with `?source=randstad`. Randstad is a staffing
agency — the lead is the **hiring client company**, not Randstad itself.

## Status

**Scaffold + fixture mode complete; live scrape handler is a stub pending
reconnaissance.** Pipeline is testable today via `mode: "fixture"`.

## Modes

- `fixture` — push `fixtures/sample-items.json` (no network).
- `scrape` — crawl randstad.dk (Playwright). **Not yet implemented** — see the
  recon TODO in `src/routes.ts`.

## Recon checklist

1. Inspect `randstad.dk/jobs/` — confirm SSR vs SPA (swap to the Cheerio base
   image if SSR). Find listing + detail selectors.
2. Extract the **client** company name, not "Randstad". When the client is
   confidential ("fortrolig"), `mapListing` substitutes `CONFIDENTIAL_COMPANY`
   = "Fortrolig (via Randstad)". Note: all confidential postings then dedup into
   a single company row (acceptable for v1).
3. `externalId` = the id from the listing detail URL.
4. Follow pagination / load-more until maxItems.

## Local run

```bash
npm install && npm run build
SBOTTER_WEBHOOK_URL='http://localhost:3000/api/ingest/apify?source=randstad' \
SBOTTER_WEBHOOK_SECRET="$APIFY_WEBHOOK_SECRET" \
  node dist/main.js
```

Shared utilities (`src/shared/`) are vendored from `apify-actors/shared/`.
