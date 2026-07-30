# Deploy Jobnet-scraperen til Apify

Cron-routen `/api/cron/scrape-jobnet` findes og kører hver nat kl. 02:00, men
den kan ikke gøre noget før actoren er **pushet til Apify** og `JOBNET_ACTOR_ID`
er sat i Vercel. Indtil da no-op'er den pænt med en log-linje:

```
[scrape] jobnet skipped — JOBNET_ACTOR_ID not configured
```

Trinene nedenfor er manuelle og engangs.

## 1. Push actoren

```bash
npm install -g apify-cli     # hvis du ikke har den
apify login                  # åbner browseren; bruger din Apify-konto
cd apify-actors/jobnet
apify push
```

`apify push` bygger Docker-imaget hos Apify og opretter actoren første gang.
Det tager typisk 2–5 minutter.

> **Push igen efter kodeændringer.** Actoren blev netop lavet input-first (den
> læser `webhookUrl`/`webhookSecret` fra input og falder tilbage til env-vars),
> og den ændring virker først når den er pushet.

## 2. Find actor-id'et

Efter `apify push` printer CLI'en en URL til actoren i konsollen. Id'et kan
skrives på to måder, og **begge virker** i `JOBNET_ACTOR_ID`:

- `<dit-brugernavn>~sbotter-jobnet` — læsbar form, ses i konsollens URL
- `abcDEF123ghiJKL45` — det 17-tegns interne id, står under **Settings →
  General → Actor ID**

Den læsbare form er nemmest at genkende senere. Cron-routen URL-encoder
værdien, så `~` er fint.

Fra terminalen kan du også liste dem:

```bash
apify actors ls
```

## 3. Sæt env-vars i Vercel

**Settings → Environment Variables**, for Production (og Preview hvis du vil
kunne teste der):

| Variabel | Værdi | Noter |
|---|---|---|
| `JOBNET_ACTOR_ID` | fra trin 2 | **Ny.** Uden den no-op'er cron'et. |
| `APIFY_TOKEN` | Apify → **Settings → Integrations → Personal API token** | Bør allerede findes (Krak-berigelsen bruger den). Bekræft at den er sat i Production. |
| `APIFY_WEBHOOK_SECRET` | vilkårlig lang tilfældig streng | Bør allerede findes. Den **samme** værdi bruges til at signere og til at verificere — se nedenfor. |
| `NEXT_PUBLIC_APP_URL` | fx `https://sbotter.vercel.app` | Bruges til at bygge webhook-URL'en. Er den forkert, poster actoren til det forkerte sted. |
| `CRON_SECRET` | vilkårlig lang tilfældig streng | Bør allerede findes; cron-routen afviser at køre uden. |

Tjek de eksisterende med:

```bash
vercel env ls production
```

### Om webhook-secret'en

Cron'et sender `webhookUrl` og `webhookSecret` **i actorens input** ved hvert
run. Actoren HMAC-SHA256-signerer sit dataset med secret'en og sender den i
`x-sbotter-signature`; `/api/ingest/apify` verificerer mod den samme
`APIFY_WEBHOOK_SECRET`.

Det betyder at secret'en kun bor **ét sted (Vercel)** og kan roteres der uden at
røre Apify. Du behøver altså **ikke** sætte `SBOTTER_WEBHOOK_URL` eller
`SBOTTER_WEBHOOK_SECRET` som actor-env-vars i Apify-konsollen — de er kun
fallback for lokale `apify run`-kørsler.

## 4. Test det

Kør cron-routen manuelt frem for at vente til kl. 02:00:

```bash
curl -i -H "Authorization: Bearer $CRON_SECRET" \
  https://sbotter.vercel.app/api/cron/scrape-jobnet
```

Forventet ved succes:

```json
{ "ok": true, "started": true, "runId": "abc123…", "actorId": "…~sbotter-jobnet", "maxItems": 500 }
```

| Svar | Betyder |
|---|---|
| `{"ok":false,"reason":"no_actor_id"}` | `JOBNET_ACTOR_ID` mangler i Vercel (trin 3) |
| `{"ok":false,"reason":"no_token"}` | `APIFY_TOKEN` mangler |
| `{"ok":false,"reason":"start_failed","detail":"HTTP 404"}` | actor-id'et findes ikke — tjek stavningen |
| `{"ok":false,"reason":"start_failed","detail":"HTTP 401"}` | forkert `APIFY_TOKEN` |
| `401 {"error":"unauthorized"}` | forkert `CRON_SECRET` i din curl |

Følg derefter runnet i Apify-konsollen → **Runs**. I loggen skal du se
`POSTing N items to https://…/api/ingest/apify` og `webhook responded 200`.
Bekræft til sidst i appen at `/leads/companies` viser friske `last_seen_at`.

## Hvordan det hænger sammen

```
Vercel Cron 02:00
      │
      ▼
/api/cron/scrape-jobnet ──POST /v2/acts/<id>/runs──▶ Apify
      (returnerer straks)                              │
                                                       │ scraper i minutter
                                                       ▼
                              actoren HMAC-signerer sit dataset
                                                       │
                                                       ▼
                                        POST /api/ingest/apify
                                                       │
                                    upsert companies + job_postings,
                                    fraværende postings → is_active=false
                                                       │
                                                       ▼
                              Vercel Cron 04:00 → /api/cron/daily-list
                                    bygger dagens lister på friske data
```

## Kadence og volumen

`0 2 * * *` (UTC), altså 03:00 CET / 04:00 CEST. To timer før daily-list-cron'et
kl. 04:00 UTC, så morgenens lister bygger på nattens data.

Runnet henter `maxItems: 500`, sorteret `PublicationDate` (nyeste først) frem
for actorens `BestMatch`-default. Jobnet har ~23.000 aktive opslag, men et
dagligt run skal kun fange det nye — 500 nyeste dækker et døgns opslag rigeligt.
Skal tallet op, er det `DAILY_MAX_ITEMS` i `src/lib/scrape.ts`.

Gentagne kørsler er idempotente: firmaer dedupes på `cvr ?? domain ?? slug`,
opslag på `(source_id, external_id)`.

## Ikke gjort endnu

De øvrige actors (`jobindex`, `jobdanmark`, `indeed`, `moment`, `randstad`) er
stilladser uden rigtige scrapere. De får hver deres runde — og hver deres
`*_ACTOR_ID` plus cron-post — når de er implementeret.
