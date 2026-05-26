# Sbotter — Moment / The Hub Actor

Scrapes startup/scaleup job postings from [thehub.io](https://thehub.io) (Moment
is now part of The Hub) and ships them to Sbotter's ingest webhook with
`?source=moment`. These are high-value leads — early-stage Danish companies.

## Status

**Scaffold + fixture mode complete; live scrape handler is a stub pending
reconnaissance.** Pipeline is testable today via `mode: "fixture"`.

## Modes

- `fixture` — push `fixtures/sample-items.json` (no network).
- `scrape` — crawl thehub.io (Playwright). **Not yet implemented** — see the
  recon TODO in `src/routes.ts`.

## Recon checklist

1. Check `thehub.io/jobs/location/denmark` — prefer a backing JSON API over DOM
   scraping if one exists (cheaper, like Jobnet's BFF).
2. `externalId` = the slug/id from the detail URL.
3. Most startups have no CVR → company dedup falls back to domain/slug (expected).
4. Paginate (`?page=N` or infinite scroll) until maxItems.

## Local run

```bash
npm install && npm run build
SBOTTER_WEBHOOK_URL='http://localhost:3000/api/ingest/apify?source=moment' \
SBOTTER_WEBHOOK_SECRET="$APIFY_WEBHOOK_SECRET" \
  node dist/main.js
```

Shared utilities (`src/shared/`) are vendored from `apify-actors/shared/`.
