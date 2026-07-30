# Prompt til Claude Code — Runde 1: friske leads + fix live-bugs

> Kopiér alt under stregen ind i Claude Code (kør fra projektets rod).
> Lav en plan og vent på et go, før du skriver kode.

---

Du skal gøre tre ting i Sbotter, i denne rækkefølge. Formålet er at få **friske leads til at flyde ind i dagslisten igen** og rette to live-bugs. Læs hele opgaven og lav en plan, før du koder.

## Læs først (bindende)

1. `AGENTS.md` — konventioner (Supabase-klienter, server actions-returshape, migrations-navngivning, RLS, env-getters, cron-mønster). Ufravigelige. Bemærk noten om at Apify-deployment + scheduling endnu ikke er sat op.
2. `src/lib/cvr.ts` (`enrichPendingCompanies` + de fire passes), `src/app/api/companies/enrich-batch/route.ts`, `src/components/leads/enrich-all-button.tsx` — for opgave A.
3. `src/lib/krak.ts` (`startKrakEnrichmentRun`) — mønsteret for at starte et Apify-actor-run via API'et. Genbrug det til opgave C.
4. `src/app/api/cron/enrich/route.ts` + `vercel.json` — cron-mønsteret.
5. `src/lib/leads/daily-list.ts` og `daily-list-core.ts` + `src/lib/leads/crm-actions.ts` — for opgave B.

## Kontekst / hvad der er galt nu

- Berigelses-knappen "Berig alle" hænger i uendelig loading. Årsag: den venter på ét synkront request, der nu kører alle fire berigelses-passes — inkl. det langsomme AI-telefon-pass (op til 15 Opus-websøgningskald á 20-40s). Samlet overstiger det funktionens `maxDuration = 300s`, så requestet returnerer aldrig rent, og knappens spinner nulstilles aldrig.
- Kun Jobnet-scraperen er rigtig implementeret; de øvrige actors er stilladser. Og **intet kører scraping på skema** — der er ingen scrape-cron. Derfor er alle leads ~2 måneder gamle. Vi retter friskheden ved at sætte den kilde, der virker (Jobnet), på et dagligt skema.
- Brugeren vil ikke betale for `CVRAPI_TOKEN`, så CVR-passet rammer 50/dag og stopper tidligt. Det er forventet — lad det være, sørg bare for at det aldrig blokerer resten.

---

## Opgave A — fix 300s-hanget (afkobl det langsomme AI-pass)

Mål: knappen returnerer altid hurtigt, og hvert baggrundsjob er garanteret under `maxDuration`.

1. **Tag AI-telefon-passet (Pass 4) ud af den interaktive sti.** `enrich-batch`-endpointet (knappen) skal kun køre de hurtige passes (CVR + website-discovery + website-scrape) med caps, der tilsammen sikkert holder sig under ~200s. Behold `stoppedOnQuota`-adfærden.
2. **Flyt AI-passet til sit eget cron.** Ny route `src/app/api/cron/ai-phone/route.ts` (samme auth/mønster som `cron/enrich`), `maxDuration = 300`, lavt cap (`AI_BATCH_LIMIT = 5`) og sleep imellem, så én kørsel altid er under budget. Tilføj den til `vercel.json` med en rolig kadence (fx hver 6. time, forskudt fra enrich-cron'et). Hvis `ANTHROPIC_API_KEY` mangler: pænt no-op.
3. Refaktorér `enrichPendingCompanies` så AI-passet kan kaldes separat (fx `runAiPhonePass()`), uden at duplikere logik. De hurtige passes og AI-passet skal kunne køres uafhængigt.
4. Knappen (`enrich-all-button.tsx`) skal under alle omstændigheder nulstille sin spinner, også hvis requestet fejler/timer ud — verificér `finally`-stien.

## Opgave B — slet et lead

Brugeren skal kunne fjerne et lead fra sin liste.

- Server action `deleteLead(id)` i `src/lib/leads/crm-actions.ts`, samme returshape og RLS-respekt som de øvrige.
- **Semantik (bekræft gerne med mig, men default):** sletning fjerner leadet fra brugerens liste *og* forhindrer, at dagsliste-motoren giver samme firma til samme bruger igen. Da `lead_assignments` har `unique (user_id, company_id)`, er den reneste løsning en blivende `deleted`-markering (fx `status = 'deleted'` eller en `deleted_at`-kolonne + `in_trash`-lignende flag), som motorens udvælgelse ekskluderer — frem for et hårdt `delete`, der ville lade firmaet dukke op igen næste morgen. Vælg én tilgang og begrund den.
- UI: en slet-/skjul-handling på lead-kortet (og gerne i dagsliste-boardet). Bekræftelse før sletning. Nye i18n-strenge i `da.json` + `en.json`.
- Opdatér `daily-list-core.ts`-udvælgelsen så slettede leads aldrig gentildeles, og dæk det med en test.

## Opgave C — sæt Jobnet på et dagligt skema

Mål: friske Jobnet-leads flyder ind automatisk, så dagslisten holdes frisk og forældede postings markeres inaktive (ingest gør allerede det sidste).

- Ny route `src/app/api/cron/scrape-jobnet/route.ts` der **starter Jobnet-actor-runnet på Apify** via runs-API'et — genbrug mønsteret fra `startKrakEnrichmentRun` i `krak.ts` (POST til `https://api.apify.com/v2/acts/<id>/runs`, med webhook-URL + secret i input). Actoren POSTer selv resultatet til det eksisterende `/api/ingest/apify`-webhook, så ingest-stien er allerede på plads.
- Nyt env: `JOBNET_ACTOR_ID` som lazy getter i `src/lib/env.ts`. Hvis den (eller `APIFY_TOKEN`) mangler: pænt no-op med log, ikke en fejl.
- Tilføj cron'et til `vercel.json` (fx dagligt kl. 02:00, før daily-list-cron'et kl. 04:00, så morgenens liste bygger på friske data).
- **Dokumentér de manuelle Apify-trin** i en kort `docs/`-note: `apify push` af `apify-actors/jobnet/`, hvor man finder actor-id'et, og hvilke env-vars der skal sættes i Vercel (`JOBNET_ACTOR_ID`, og bekræft `APIFY_TOKEN` + webhook-secret). Antag ikke at actoren allerede er deployet.

Rør **ikke** de øvrige stub-actors (jobindex, indeed osv.) i denne omgang — de kommer i separate runder.

## Sådan skal du arbejde

- Inkrementelt, commit pr. opgave (A → B → C).
- Følg server actions-returshapen, env-getter-reglen (aldrig `process.env` uden for `env.ts`), RLS-mønsteret og cron-auth-mønsteret.
- Skriv/opdatér tests: at de hurtige passes og AI-passet kan køre uafhængigt (A), at slettede leads ikke gentildeles (B). Mock eksterne kald — ingen ægte API-kald i tests.
- i18n-strenge i begge locales for al ny UI.

## Definition of done

- [ ] "Berig alle" returnerer hurtigt og efterlader aldrig en evig spinner; AI-passet kører kun via sit eget cron.
- [ ] Hvert baggrundsjob (enrich-batch og de to nye crons) er realistisk under `maxDuration`.
- [ ] Et lead kan slettes fra UI'et og gentildeles aldrig af dagsliste-motoren; dækket af en test.
- [ ] `scrape-jobnet`-cron'et starter et Apify-run (eller no-op'er pænt uden token/actor-id), og Apify-opsætningen er dokumenteret.
- [ ] `npm run build` + lint + typecheck + `npm test` grønne.

## Guardrails

- Rør ikke ingest-normaliseringen (`src/lib/ingest/*`) eller de øvrige stub-actors.
- AI-telefon-laget må stadig aldrig overskrive et betroet nummer (fill-empty-only står ved magt) — du flytter kun *hvornår* det kører.
- Ingen ægte eksterne kald i tests.
- Start med at give mig din plan (filer, migration hvis nødvendig for slet-semantikken, og din foreslåede slet-tilgang) og vent på et go, før du koder.
