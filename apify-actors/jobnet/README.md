# Sbotter — Jobnet.dk Actor

Crawlee Actor that scrapes job postings from job.jobnet.dk and ships them to the Sbotter ingest webhook.

## Local development

```bash
cd apify-actors/jobnet
npm install
npm run build

# Fixture mode (default) — pushes the bundled sample-items.json
SBOTTER_WEBHOOK_URL=http://localhost:3000/api/ingest/apify \
SBOTTER_WEBHOOK_SECRET=$APIFY_WEBHOOK_SECRET \
  npx apify run --purge
```

Set `mode: "scrape"` in the run input (or `.actor/input.json` for `apify run`) to crawl Jobnet for real. The selectors in `src/routes.ts` are best-guess and should be confirmed against the live markup before relying on them in production.

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
