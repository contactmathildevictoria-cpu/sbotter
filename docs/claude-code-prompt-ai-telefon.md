# Prompt til Claude Code — AI-telefon-lag (Pass 4)

> Kopiér alt under stregen ind i Claude Code (kør den fra projektets rod).
> Dette er en tilføjelse til den eksisterende berigelses-pipeline — ikke en ny pipeline.

---

Du skal tilføje et **fjerde og sidste lag til vores telefon-berigelse i Sbotter**: en AI-baseret telefonfinder, der kun kører for firmaer, hvor CVR, Krak og website-scraping alle er kommet op tomme. Læs hele opgaven, lav en plan, og vent på et kort go, før du skriver kode.

## Læs først (bindende)

1. `AGENTS.md` — repoets konventioner. Ufravigelige (Supabase-klienter, server actions-returshape, migrations-navngivning, RLS, env-getters). Bemærk `enrichment`-jsonb-kolonnen og at "Claude enrichment of companies" allerede står som en planlagt, ikke-bygget ting — dette lag er præcis det.
2. `src/lib/cvr.ts` — særligt `enrichPendingCompanies()`, som orkestrerer berigelsen i "passes" (CVR → website-discovery → website-scrape). Du skal tilføje et **Pass 4** i samme mønster.
3. `src/lib/website-scraper.ts` — genbrug `PHONE_RE` og `normalizePhone` herfra til at validere formatet af et AI-fundet nummer.
4. `src/lib/krak.ts` — kopiér mønsteret for **fill-empty-only** provenans (dedikerede `krak_*`-kolonner + `krak_url`). Vores nye kolonner spejler dette.

Skriv ikke kode, før du forstår, hvordan de tre eksisterende telefon-lag skriver til `companies`, og hvordan lead-UI'et vælger telefon via fallback-kæden `phone ?? krak_phone ?? website_phone`.

## Hvorfor (kontekst)

De tre eksisterende lag fanger de fleste numre, men efterlader en hale af firmaer helt uden telefon. En LLM med websøgning kan finde nummeret på den lange hale (fx via Proff, LinkedIn, lokale sider) og desuden finde firmaets rigtige hjemmeside, når vores egen discovery fejler. **Den store risiko: en LLM kan finde på et realistisk, men falsk telefonnummer.** Derfor er kravet: modellen må kun returnere et nummer, den kan pege på en **kilde-URL** for. Vi gemmer den URL og viser et lille ikon i lead-kortet, der linker til kilden — så sælgeren altid kan se, at nummeret er AI-fundet, og selv tjekke det. Vi verificerer altså via proveniens + menneske, ikke via et tungt automatisk fetch-og-tjek-trin.

## Scope for DENNE opgave

### 1. Migration — nye kolonner på `companies`

Ny migration (`YYYYMMDDHHMMSS_ai_enrichment.sql`), samme idempotente stil som `20260526120000_website_enrichment.sql`:

```sql
alter table public.companies
  add column if not exists ai_phone text,
  add column if not exists ai_contact_person text,
  add column if not exists ai_source_url text,          -- proveniens: hvor nummeret blev fundet
  add column if not exists ai_enriched_at timestamptz,
  add column if not exists ai_enrichment_status text not null default 'pending';
```

Statussæt (guardet `do $$`-blok med check-constraint, som de øvrige):
`pending` (ikke forsøgt) · `enriched` (fandt nummer med kilde) · `no_match` (intet troværdigt nummer fundet) · `failed` (fejl/timeout, kan prøves igen) · `skipped` (havde allerede et nummer). Tilføj et partial-index på `ai_enrichment_status = 'pending'` som de andre lag.

### 2. AI-finderen — `src/lib/ai-phone.ts`

`server-only`. Én funktion `findPhoneViaAI(company: { name, city, website })` der:

- Kalder en LLM med websøgning/tool-use. Læg API-nøglen som lazy getter i `src/lib/env.ts` (fx `anthropicApiKey`) — **aldrig** `process.env` direkte.
- Prompter modellen stramt: find firmaets hovedtelefonnummer (dansk 8-cifret) og evt. en kontaktperson, og **returnér ALTID den præcise kilde-URL, nummeret står på.** Hvis den ikke kan finde et nummer med en kilde, skal den returnere "intet fundet" — den må aldrig gætte.
- Kræver struktureret output: `{ phone, contactPerson, sourceUrl }` eller `null`.
- **Validerer formatet** med `normalizePhone` fra website-scraperen; kasserer numre der ikke er et plausibelt dansk nummer, og kasserer resultater uden `sourceUrl`.
- Kaster aldrig — returnerer `null` ved enhver fejl/timeout. Best-effort, som de andre lag.

Bemærk: vi laver **ikke** det tunge "hent kildesiden og bekræft nummeret står der"-trin i denne omgang. Kilde-URL + ikonet i UI'et er den bevidste, lettere løsning. Skriv koden så et sådant verifikationstrin nemt kan tilføjes senere (en klart afgrænset funktion).

### 3. Apply + orkestrering

- `applyAiPhoneResult(companyId, result)` i samme fil: **fill-empty-only**, skriver kun `ai_*`-kolonnerne + status, rører aldrig `phone`/CVR/Krak/website. Dobbelt-guard: skriv kun et nummer hvis `phone`, `krak_phone` og `website_phone` alle er `null`.
- Tilføj et **Pass 4** i `enrichPendingCompanies()` i `src/lib/cvr.ts`: vælg firmaer hvor `phone`, `krak_phone` og `website_phone` alle er `null` og `ai_enrichment_status = 'pending'`, ældste først, **cappet lavt** (fx `AI_BATCH_LIMIT = 15`) fordi hvert kald er dyrt og langsomt. Sleep mellem kald. Retire firmaer der allerede har et nummer til `skipped` (som website-passet gør). Udvid `BatchEnrichSummary` med et `ai`-felt (`processed`, `enriched`, `noMatch`, `failed`, `remaining`).

### 4. UI — kilde-ikon i lead-kortet

- Læg en helper i `src/lib/leads/contact.ts` (eller udvid den eksisterende), der returnerer både nummeret **og dets kilde**: `phone` (CVR) / `krak_phone` / `website_phone` = betroet, ingen markering; `ai_phone` = AI-kilde med `ai_source_url`.
- I lead-kortet: når telefonen kommer fra `ai_phone`, vis et lille ikon ved siden af nummeret (fx `ti-sparkles`), der linker til `ai_source_url` (åbner i ny fane, `rel="noopener"`). Tooltip/aria-label: "Telefonnummer fundet automatisk — klik for at se kilden." De tre betroede kilder får intet ikon.
- i18n: nye strenge i både `src/messages/da.json` og `en.json`.

## Sådan skal du arbejde

- **Inkrementelt**, commit pr. trin: migration → `ai-phone.ts` + test → Pass 4 → UI.
- **Fill-empty-only** er ufravigeligt — dette lag må aldrig overskrive et nummer fra CVR/Krak/website.
- Følg server actions-returshapen og env-getter-reglen.
- **Skriv en test** for `findPhoneViaAI`s efterbehandling: at et resultat uden `sourceUrl` kasseres, at et ugyldigt telefonformat kasseres, og at `applyAiPhoneResult` ikke skriver, når firmaet allerede har et nummer fra et betroet lag. Mock LLM-kaldet — testen må ikke ramme et rigtigt API.
- Hold LLM-kaldet bag en klar timeout, og log samme stil som de andre lag (`[ai] …`).

## Definition of done

- [ ] Migration kører rent og er idempotent.
- [ ] Pass 4 kører kun for firmaer uden noget nummer, cappet og med sleep.
- [ ] Et AI-nummer uden kilde-URL gemmes aldrig; et betroet nummer overskrives aldrig.
- [ ] Lead-kortet viser kilde-ikonet (linket til `ai_source_url`) kun for AI-fundne numre.
- [ ] Tests for validering + fill-empty-only passerer; LLM-kaldet er mocket.
- [ ] `npm run build` + lint + typecheck er grønne.

## Guardrails

- **Rør ikke** de eksisterende telefon-lag (`cvr.ts`-logikken, `krak.ts`, `website-scraper.ts`) ud over at tilføje Pass 4 og genbruge `PHONE_RE`/`normalizePhone`.
- Ingen ægte API-kald i tests.
- Hvis LLM-API'et eller nøglen ikke er sat, skal Pass 4 være et pænt no-op (log + spring over), ikke en fejl der vælter batchen.
- Start med at give mig din plan (filer + migration + hvilket LLM/websøgnings-API du foreslår) og vent på et go, før du skriver kode.
