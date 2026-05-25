# Sbotter — Jobindex.dk Actor

Scrapes job postings from [jobindex.dk](https://www.jobindex.dk) and ships them
to Sbotter's ingest webhook with `?source=jobindex`.

## Status

**Scaffold + fixture mode complete; live scrape handler is a stub pending
reconnaissance.** The mapping contract (`mapListing` in `src/routes.ts`) and
`fixtures/sample-items.json` are done, so the full ingest pipeline is testable
today via `mode: "fixture"`.

## Modes

- `fixture` — push `fixtures/sample-items.json` (no network; local pipeline test).
- `scrape` — crawl jobindex.dk (Cheerio over HTTP). **Not yet implemented** — see
  the recon TODO in `src/routes.ts`.

## Recon checklist (to implement scrape mode)

1. Inspect `https://www.jobindex.dk/jobsoegning` — confirm server-rendered HTML
   and the listing-card / title / company / location / detail-link selectors.
2. Confirm pagination param (`?page=N`) and the location query param name.
3. Build `RawJobindexListing` per card → `mapListing()` → `pushData`.
4. `externalId` = the job number from the `/jobannonce/<id>` detail URL.

## Local run

```bash
npm install && npm run build
SBOTTER_WEBHOOK_URL='http://localhost:3000/api/ingest/apify?source=jobindex' \
SBOTTER_WEBHOOK_SECRET="$APIFY_WEBHOOK_SECRET" \
  node dist/main.js   # defaults to fixture mode
```

Shared utilities (`src/shared/`) are vendored from `apify-actors/shared/` via
`npm run sync:shared` — edit the source there, not the copies.
