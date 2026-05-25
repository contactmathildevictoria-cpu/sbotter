# Shared Actor utilities

Single source of truth for code reused across every Sbotter Apify Actor.

- `src/types.ts` — `ScrapedListing`, the nested shape every Actor emits (mirrors the app's `jobnetItemSchema` in `src/lib/ingest/normalize.ts`).
- `src/utils.ts` — `stripHtml`, `normalizeDate` (Danish/relative/ISO dates), `normalizeDanishPhone`.

## How it reaches each Actor

Each Actor's `.actor/Dockerfile` uses its **own directory** as the Docker build
context, so a `../shared` import would never be copied into the image and
`apify push` would fail. Instead we **vendor** the files: `npm run sync:shared`
(from `apify-actors/`) copies `shared/src/*` into every `<actor>/src/shared/`.
Those copies are committed, so each Actor's unchanged `COPY . ./` picks them up.

Actors import them with a relative path + `.js` extension (NodeNext):

```ts
import type { ScrapedListing } from "./shared/types.js";
import { stripHtml, normalizeDate } from "./shared/utils.js";
```

**Workflow:** edit `shared/src/*`, then run `npm run sync:shared` and commit the
regenerated `<actor>/src/shared/` files alongside.
