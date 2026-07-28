# Prompt til Claude Code — Sbotter 2.0, Fase 1

> Kopiér alt under stregen ind i Claude Code (kør den fra projektets rod).
> Den refererer til to filer der allerede ligger i repoet, så prompten kan holdes fokuseret på *hvordan* du vil have det bygget.

---

Du skal bygge **Fase 1 af en omstrukturering af Sbotter** — vores lead-genereringsplatform. Læs denne opgave helt igennem, og lav derefter en plan, før du skriver kode.

## Læs først (bindende)

1. `AGENTS.md` — repoets konventioner. De er ufravigelige (Supabase-klienter, server actions-returshape, migrations-navngivning, RLS, i18n, env-getters, proxy/auth). Bemærk især at dette er Next.js 16 med `proxy.ts` (ikke `middleware.ts`).
2. `docs/fase-1-liste-motor-og-crm.md` — den fulde tekniske plan for denne opgave. Den er din opskrift: datamodel, SQL, motor-logik, server actions, UI og byggerækkefølge. Følg den. Afvig kun hvis du finder en konkret konflikt med koden — og sig til først.

Skriv ikke kode, før du har læst begge filer og kort bekræftet, at du forstår den nuværende datamodel (`companies`, `job_postings`, enrichment-kolonner) og ingest-pipelinen.

## Hvorfor (kontekst)

Sbotter er i dag én stor søgbar pulje på ~1500 leads, som brugeren selv filtrerer. Vi laver et paradigmeskifte: **en frisk daglig leadliste pr. bruger** (fx 50 leads/dag) med et **CRM ovenpå**. Friske leads prioriteres altid; "no pickup"-leads ryger i en skraldespand og kommer op igen efter en uge. Egne kunder, fravalgte brancher og lukkede firmaer sorteres fra. Den eksisterende scraping- og enrichment-pipeline bevares — vi bygger *laget ovenpå*.

## Scope for DENNE opgave

Byg **kun Fase 1**:

- Migrations: `list_preferences`, `lead_assignments` (CRM-kernen: status, rating 1–10, note, follow_up_at, skraldespand-flag), `excluded_companies`, `blocked_industries` — alt med RLS hvor brugeren kun ser egne rækker.
- Den daglige liste-motor (`src/lib/leads/daily-list.ts`) med prioritetsrækkefølgen: **friske leads → planlagt genbrug fra skraldespand (cap = trash_max) → nødfyld hvis skrab var tyndt.**
- Cron-route + scheduled task der kører motoren hver morgen pr. bruger.
- Server actions (`src/lib/leads/crm-actions.ts`): status, rating, note, egne kunder, brancher, præferencer.
- UI: ny rute `/leads/today` med et CRM-board og lead-kort, samt udvidet indstillingsside.

**IKKE i denne opgave (Fase 2 — lad være):** LinkedIn-actor, kommunale actors, og flytning af kontaktperson fra firma- til job-niveau. Læg blot en nullable `job_posting_id` på `lead_assignments`, så vi kan koble den senere — men byg ikke kilderne nu.

## Krav til lead-kortet (vigtigt for UI)

På hvert kort skal følgende kunne læses **uden at folde ud**: firmanavn, kontaktperson, telefonnummer og rating. På kortet skal man desuden kunne **sætte rating 1–10** og **skrive en note** (auto-gem, debounced) samt ændre status via knapper. Telefon som `tel:`-link. Genbrug den eksisterende fallback-kæde til kontaktdata: telefon = `phone ?? krak_phone ?? website_phone`, kontaktperson = `contact_person_name ?? krak_contact_person ?? website_contact_person` (læg gerne en helper i `src/lib/leads/contact.ts`).

## Sådan skal du arbejde

- **Inkrementelt.** Følg byggerækkefølgen i planen (afsnit 5). Lav ét logisk trin ad gangen og commit undervejs med klare beskeder.
- **Én migration pr. koncept**, filnavn `YYYYMMDDHHMMSS_beskrivelse.sql`. Migrations skal kunne køre rent på en frisk database og være idempotente (`if not exists`, guardede `do $$`-blokke) som de eksisterende.
- **Følg returshapen** `{ ok: true; data?: T } | { ok: false; error: string }` i alle server actions, valider input med zod, kast aldrig til klienten.
- **RLS-mønster** som de øvrige egne-rækker-tabeller (`auth.uid() = user_id`). Brug `server.ts`-klienten i actions (respekterer RLS) og `service.ts` kun i den cron-kørte motor.
- **Ingen `process.env`** uden for `src/lib/env.ts` — tilføj nye secrets som lazy getters der.
- **i18n:** alle nye brugervendte strenge i både `src/messages/da.json` og `en.json`. Importér `Link`/`useRouter` fra `@/lib/i18n/navigation`.
- **Skriv en test** for motorens prioritetslogik: at friske vælges først, at genbrug capper på `trash_max`, at nødfyld kun sker ved for få friske, og at ekskluderede firmaer + fravalgte brancher + konkursramte firmaer aldrig kommer med. Motoren skal være idempotent — to kørsler samme dag må ikke lave dubletter.

## Definition of done (acceptkriterier)

- [ ] Alle migrations kører rent (`supabase migration up` lokalt) uden fejl.
- [ ] `generateDailyList(userId)` producerer en liste på `daily_target`, med korrekt prioritet og alle filtre; dækket af tests der passerer.
- [ ] `unique (user_id, company_id)` gør, at samme firma aldrig gives to gange til samme bruger.
- [ ] "No pickup" flytter leadet i skraldespanden og sætter `follow_up_at = i dag + follow_up_days`; det dukker op igen når datoen er nået.
- [ ] `/leads/today` viser boardet med lead-kort, hvor navn/kontaktperson/telefon/rating ses uden at folde ud, og rating + note kan sættes på kortet.
- [ ] Indstillingssiden kan redigere antal/dag, max fra skraldespand, opfølgnings-interval, egne kunder og fravalgte brancher.
- [ ] `npm run build` + lint + typecheck er grønne.
- [ ] Den eksisterende ingest-pipeline og `/leads/companies`-puljen virker stadig uændret.

## Guardrails

- **Rør ikke** `src/lib/ingest/*` (normalize/apify/route), Apify-actorsne eller den eksisterende webhook-signaturverifikation, medmindre en opgave udtrykkeligt kræver det — og sig så til først.
- Bevar `/leads/companies` som "udforsk hele databasen"-visning; den daglige liste er en *ny* rute ved siden af.
- Hvis noget i planen er tvetydigt eller i konflikt med koden, så **stop og spørg** i stedet for at gætte.
- Start med at give mig din plan (filer du vil oprette/ændre + migrations-rækkefølge) og vent på et kort go, før du skriver kode.
