# AI-telefonfinderen (fjerde berigelseslag)

Det fjerde og sidste lag i telefon-berigelsen. Kører **kun** for firmaer hvor
CVR, Krak og website-scraperen alle er kommet op tomme. En LLM med websøgning
slår nummeret op i den lange hale — Proff, LinkedIn, lokale sider.

## Kernereglen: proveniens

En LLM kan finde på et realistisk, men falsk telefonnummer. Derfor:

> **Et nummer uden kilde-URL bliver aldrig gemt.**

Modellen skal rapportere den præcise URL, nummeret står på. Den URL gemmes i
`companies.ai_source_url` og vises i UI'et som et lille ikon ved siden af
nummeret, der linker til kilden. Sælgeren kan altid se at nummeret er
AI-fundet, og selv tjekke det.

Vi verificerer altså via **proveniens + menneske**, ikke via et tungt
automatisk hent-og-bekræft-trin. Skal det trin tilføjes senere, er det en klart
afgrænset funktion at hænge på `validateAiResult` i `src/lib/ai-phone-core.ts`.

## Filer

| Fil | Rolle |
|---|---|
| `src/lib/ai-phone-core.ts` | **Ren.** Prompt, værktøjsskema, validering, fill-empty-only-beslutningen. Al logik der kan være forkert. Testet i `ai-phone-core.test.ts` uden netværk eller database. |
| `src/lib/ai-phone.ts` | `server-only`. Selve API-kaldet og skrivningen til Supabase. |
| `src/lib/phone.ts` | `PHONE_RE` + `normalizePhone`, delt med website-scraperen — én definition af "et plausibelt dansk nummer". |

## Model og omkostning

Modelnavnet står **ét sted**: `AI_MODEL` i `ai-phone-core.ts`. Et skifte til
`claude-sonnet-5` er den ene linje.

| | |
|---|---|
| Model | `claude-opus-5` ($5 / $25 pr. 1M tokens) |
| Effort | `low` — det primære omkostningshåndtag på denne model |
| Søgeværktøj | `web_search_20260209` (kræver Opus 4.6+ / Sonnet 4.6+), `max_uses: 5` |
| Batch-loft | `AI_BATCH_LIMIT = 15` pr. kørsel, `sleep(2000)` imellem |
| Timeout | 90 s pr. opslag, 1 retry |

Websøgning faktureres per søgning oven i tokens. Pass 4 logger derfor antal
kald, antal søgninger og tokenforbrug pr. batch — se `[ai] pass 4`-linjen i
cron-loggen.

Uden `ANTHROPIC_API_KEY` springer Pass 4 pænt over med en log-linje; resten af
berigelsen kører videre.

## Åbent spørgsmål: outputform

Der er to måder at få et struktureret svar ud sammen med et server-side
søgeværktøj:

- **Shape A** — `output_config.format` med et JSON-schema på selve svaret.
- **Shape B** — et client-side værktøj med `strict: true`, som modellen kalder
  med resultatet. *Dette er det, der er implementeret.*

Dokumentationen siger ikke om A kan kombineres med server-tools (den nævner kun
citations og prefill som inkompatible). Det kunne ikke afgøres empirisk, fordi
der ikke var en API-nøgle tilgængelig. Shape B er valgt fordi den er korrekt
**uanset** hvordan spørgsmålet falder ud.

Vil du afgøre det: kør

```bash
set -a; . ./.env.local; set +a
node scripts/probe-ai-output-shape.mjs
```

Det koster to rigtige kald. Viser den at A virker, sparer et skifte ét
værktøjs-round-trip pr. opslag; ændringen er isoleret til `ai-phone.ts` plus
request-konstanterne i `ai-phone-core.ts`.
