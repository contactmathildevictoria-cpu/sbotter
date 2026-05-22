# Sbotter — Jobnet.dk Actor

Apify Actor that pulls job postings from Jobnet.dk and ships them to the Sbotter ingest webhook.

## How it works

Jobnet.dk is a Next.js + Relay single-page app — there is **no server-rendered HTML to scrape**. Job listings come from a session-gated JSON BFF endpoint:

```
GET https://jobnet.dk/bff/FindJob/Search
    ?resultsPerPage=&pageNumber=&orderType=BestMatch&kmRadius=50&searchString=
```

It returns 401 to anonymous callers. So `scrape` mode uses **Playwright** to load `/find-job` once (which sets the session cookie), then calls the BFF directly with an `x-csrf: 1` header and paginates. Each ad is mapped in `src/routes.ts` (`mapJobAd`) to the unified shape that `src/lib/ingest/normalize.ts` expects in the Sbotter app, so data flows straight into Supabase via the webhook.

Two run modes (set `mode` in the input):

- **`fixture`** (default) — pushes the bundled `fixtures/sample-items.json`. No network.
- **`scrape`** — live pull from Jobnet. Inputs: `searchString`, `maxItems`, `orderType` (`BestMatch` | `PublicationDate`).

## Local development

```bash
cd apify-actors/jobnet
npm install
npx playwright install chromium   # scrape mode needs a browser
npm run build

# Scrape mode (live), shipping results to a locally-running Sbotter app:
SBOTTER_WEBHOOK_URL=http://localhost:3000/api/ingest/apify \
SBOTTER_WEBHOOK_SECRET=$APIFY_WEBHOOK_SECRET \
  npx apify run --purge --input='{"mode":"scrape","searchString":"marketing","maxItems":50,"orderType":"PublicationDate"}'
```

> Heads-up: the BFF uses a simple `x-csrf: 1` guard plus the session cookie. If Jobnet changes the endpoint path, params, or CSRF scheme, update `SEARCH_PATH` / headers in `src/routes.ts`.

## Webhook signing

The Actor POSTs the dataset to `SBOTTER_WEBHOOK_URL` with an `x-sbotter-signature` header equal to `HMAC-SHA256(body, SBOTTER_WEBHOOK_SECRET)`. The Sbotter server verifies this signature against its own `APIFY_WEBHOOK_SECRET` env var — they must match.

## Deploy to Apify

```bash
apify login
apify push
```

Then in the Apify Console set:

- `SBOTTER_WEBHOOK_URL` — production webhook URL (e.g. `https://sbotter.example.com/api/ingest/apify`)
- `SBOTTER_WEBHOOK_SECRET` — the same secret as the server's `APIFY_WEBHOOK_SECRET`

Schedule the Actor via the Apify Console (Schedules → Create → pick this Actor → daily).

## Testing the ingest webhook without Apify

You don't need this Actor at all to exercise the server-side ingest pipeline. From the repo root:

```bash
BODY=$(cat apify-actors/jobnet/fixtures/sample-payload.json)
SIG=$(echo -n "$BODY" | openssl dgst -sha256 -hmac "$APIFY_WEBHOOK_SECRET" | awk '{print $2}')
curl -X POST http://localhost:3000/api/ingest/apify \
  -H "content-type: application/json" \
  -H "x-sbotter-signature: $SIG" \
  --data-binary "$BODY"
```

A 200 response with `{ "ok": true, "companiesUpserted": 3, "jobsUpserted": 5, ... }` confirms the round-trip works.
