# Sbotter — JobDanmark.dk Actor

Scrapes job postings from [jobdanmark.dk](https://www.jobdanmark.dk) and ships
them to Sbotter's ingest webhook with `?source=jobdanmark`. JobDanmark often
exposes a **contact email/phone** on listings — these are captured into
`contactEmail` / `contactPhone` and preserved on `job_postings.raw` server-side.

## Status

**Scaffold + fixture mode complete; live scrape handler is a stub pending
reconnaissance.** Pipeline is testable today via `mode: "fixture"`.

## Modes

- `fixture` — push `fixtures/sample-items.json` (no network).
- `scrape` — crawl jobdanmark.dk (Cheerio over HTTP). **Not yet implemented** —
  see the recon TODO in `src/routes.ts`.

## Recon checklist

1. Inspect `https://www.jobdanmark.dk/jobsoegning` — listing-card + detail-page
   selectors; confirm server-rendered.
2. Capture the contact email + phone from the detail page → `contactEmail` /
   `contactPhone` (phone runs through `normalizeDanishPhone`).
3. `externalId` = the id from the listing detail URL.
4. Follow pagination until maxItems.

## Local run

```bash
npm install && npm run build
SBOTTER_WEBHOOK_URL='http://localhost:3000/api/ingest/apify?source=jobdanmark' \
SBOTTER_WEBHOOK_SECRET="$APIFY_WEBHOOK_SECRET" \
  node dist/main.js
```

Shared utilities (`src/shared/`) are vendored from `apify-actors/shared/`.
