# Sbotter — Krak.dk enricher Actor

Apify Actor that looks companies up on [Krak.dk](https://www.krak.dk) (the Danish
phone directory) to find a **phone number** and **contact person** that the CVR
registry doesn't have, then ships the results to Sbotter's Krak ingest webhook.

## Why Krak

CVR only holds phone numbers companies voluntarily registered with the Danish
Business Authority. Krak sources its numbers from telco subscriber records — a
different dataset — so it often has a phone where CVR is empty. This Actor is a
fallback that runs _after_ CVR enrichment for companies still missing a phone.

## How it works

Unlike the job-scraping Actors, this one takes a **list of companies to look up**
as input (not a search query). Sbotter collects companies with no phone, starts a
run via the Apify API, and passes them in. For each company the Actor searches
Krak by name (+ city), reads the top business result, and **conservatively**
decides whether it's really the same company — wrong data is worse than no data,
so anything ambiguous is reported as `matched: false`.

Krak returns **403 to plain HTTP**, so scrape mode uses **Playwright** (real
browser). Companies are processed one at a time with a **2-second pause** between
each to avoid being blocked. Max **100 companies per run**.

Results are mapped in `src/routes.ts` to `KrakLookupResult` (shared type) and
posted to `POST /api/ingest/krak`, signed with HMAC-SHA256 over the raw body
(`x-sbotter-signature`). Sbotter fills only the dedicated `krak_*` columns — it
never overwrites CVR data.

> ⚠️ **RECON TODO:** the live DOM selectors and the search-URL shape in
> `src/routes.ts` (and `lookupStartRequests`) are a **best guess** and must be
> verified against the real krak.dk before scrape mode is trusted. Fixture mode
> and the entire Sbotter-side pipeline work today regardless.

## Run modes

Set `mode` in the input:

- **`fixture`** (default) — pushes the bundled `fixtures/sample-results.json`. No
  network. Use this to test the whole start→webhook→DB→UI loop end to end.
- **`scrape`** — live lookups on Krak. Input:
  - `companies` — `[{ id, name, city }]` (the `id` is the Sbotter company UUID,
    echoed back as `companyId`).
  - `maxItems` — hard cap (≤100).
  - `webhookUrl` / `webhookSecret` — where to POST results + the HMAC key.
    Read input-first, then falls back to the `SBOTTER_WEBHOOK_URL` /
    `SBOTTER_WEBHOOK_SECRET` env vars.

## Local development

```bash
npm install
npm run build

# Fixture run that posts to a local Sbotter:
apify run -i '{
  "mode": "fixture",
  "companies": [],
  "webhookUrl": "http://localhost:3000/api/ingest/krak",
  "webhookSecret": "<your local APIFY_WEBHOOK_SECRET>"
}'
```

The shared types/utils in `src/shared/` are vendored copies of
`apify-actors/shared/src/`; regenerate them with `npm run sync:shared` at the
`apify-actors/` workspace root after editing the shared sources.
