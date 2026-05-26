import { type PlaywrightCrawlingContext, type RequestOptions } from "crawlee";
import type { KrakCompanyInput, KrakLookupResult } from "./shared/types.js";
import { normalizeDanishPhone } from "./shared/utils.js";

const BASE_URL = "https://www.krak.dk";

// Confirmed via live recon: Krak's company search lives at
//   https://www.krak.dk/<query>/firmaer
// where <query> is the search term lowercased with spaces → "+", e.g.
//   "Novo Nordisk" → https://www.krak.dk/novo+nordisk/firmaer
// (The homepage search box rewrites to exactly this URL.) `firmaer` = companies.
function searchUrl(name: string): string {
  const slug = name.trim().toLowerCase().replace(/\s+/g, "+");
  return `${BASE_URL}/${encodeURIComponent(slug).replace(/%2B/g, "+")}/firmaer`;
}

// Build one search request per company, carrying the company in userData so the
// handler can match + echo back its id.
export function lookupStartRequests(
  companies: KrakCompanyInput[],
): RequestOptions[] {
  return companies.map((company) => ({
    url: searchUrl(company.name),
    label: "LOOKUP",
    userData: { company },
  }));
}

// Normalize a company name for conservative comparison: lowercase, drop common
// Danish company-form suffixes, strip punctuation, collapse whitespace.
function normalizeCompanyName(value: string): string {
  return value
    .toLowerCase()
    .replace(/\b(aps|a\/s|i\/s|p\/s|ivs|k\/s|holding|gruppen|group)\b/g, "")
    .replace(/[^a-z0-9æøå ]/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Conservative match: only true when the names clearly correspond. Wrong data is
// worse than no data, so anything ambiguous returns false (→ matched: false).
export function namesMatch(input: string, candidate: string | null): boolean {
  if (!candidate) return false;
  const a = normalizeCompanyName(input);
  const b = normalizeCompanyName(candidate);
  if (!a || !b) return false;
  if (a === b) return true;
  const shorter = a.length <= b.length ? a : b;
  const longer = a.length <= b.length ? b : a;
  if (shorter.length < 4) return false; // too short to be a confident signal
  return (
    longer === shorter ||
    longer.startsWith(`${shorter} `) ||
    longer.endsWith(` ${shorter}`) ||
    longer.includes(` ${shorter} `)
  );
}

// Title/markers Cloudflare shows while challenging (da + en).
function looksLikeChallenge(title: string, bodyLen: number): boolean {
  return /just a moment|et øjeblik|attention required|checking your browser/i.test(title) || bodyLen < 800;
}

// Shape returned from the in-page DOM read (before normalization/matching).
type RawKrak = {
  resultName: string | null;
  phoneRaw: string | null;
  contactPerson: string | null;
  contactTitle: string | null;
  krakUrl: string | null;
};

function unmatched(company: KrakCompanyInput): KrakLookupResult {
  return {
    companyId: company.id,
    matched: false,
    phone: null,
    contactPerson: null,
    contactTitle: null,
    krakUrl: null,
  };
}

export function createKrakLookupHandler() {
  return async ({ page, request, log, pushData }: PlaywrightCrawlingContext) => {
    const company = (request.userData as { company: KrakCompanyInput }).company;

    try {
      // Wait out Cloudflare's interstitial. The challenge auto-solves only with a
      // good fingerprint + residential proxy (configured in main.ts); poll until
      // the real page renders, or give up and skip (never scrape the challenge).
      let cleared = false;
      for (let i = 0; i < 12; i++) {
        await page.waitForTimeout(2_500);
        const probe = await page.evaluate(() => ({
          title: document.title,
          bodyLen: document.body?.innerText?.length ?? 0,
        }));
        if (!looksLikeChallenge(probe.title, probe.bodyLen)) {
          cleared = true;
          break;
        }
      }

      if (!cleared) {
        log.warning(
          `[krak] Cloudflare challenge not cleared for "${company.name}" — skipping. ` +
            `(Needs a residential proxy + fingerprints; see main.ts.)`,
        );
        await pushData(unmatched(company));
      } else {
        // RECON TODO: the field selectors below could not be verified live — the
        // search results sit behind Cloudflare and never rendered from the dev
        // sandbox (datacenter IP, no residential proxy). They lean on the most
        // stable signals (tel: links, /firma profile links, headings) rather than
        // brittle CSS classes, but MUST be confirmed against a real rendered page
        // from a residential-proxy run on Apify, then tightened. Until then a
        // miss yields null → matched:false (a skip), never wrong data.
        const raw = await page.evaluate((): RawKrak => {
          const text = (el: Element | null): string | null => {
            const t = el?.textContent?.trim();
            return t && t.length ? t : null;
          };

          // First company result: prefer a link into a /firma(er)/profil page.
          const firstLink = document.querySelector(
            "a[href*='/firma/'], a[href*='/firmaer/'], a[href*='/profil/'], main h2 a, main h3 a",
          ) as HTMLAnchorElement | null;

          // Scope extraction to the result card containing that link, if found.
          const card =
            firstLink?.closest("article, li, [class*='result'], [class*='hit'], [class*='card']") ??
            document.querySelector("main") ??
            document.body;

          const resultName = text(firstLink) ?? text(card.querySelector("h2, h3"));

          const telLink = card.querySelector(
            "a[href^='tel:']",
          ) as HTMLAnchorElement | null;
          const phoneRaw =
            telLink?.getAttribute("href")?.replace(/^tel:/, "")?.trim() || null;

          const contactPerson = text(
            card.querySelector(
              "[class*='contact'] [class*='name'], [class*='person'], [class*='kontakt']",
            ),
          );
          const contactTitle = text(
            card.querySelector("[class*='title'], [class*='role'], [class*='stilling']"),
          );

          return {
            resultName,
            phoneRaw,
            contactPerson,
            contactTitle,
            krakUrl: firstLink?.href ?? null,
          };
        });

        const phone = normalizeDanishPhone(raw.phoneRaw);
        const matched = namesMatch(company.name, raw.resultName) && Boolean(phone);

        if (!matched) {
          log.info(
            `[krak] no clear match for "${company.name}" (saw "${raw.resultName ?? "—"}", phone=${phone ?? "—"})`,
          );
          await pushData(unmatched(company));
        } else {
          log.info(`[krak] matched "${company.name}" → ${phone}`);
          await pushData({
            companyId: company.id,
            matched: true,
            phone,
            contactPerson: raw.contactPerson,
            contactTitle: raw.contactTitle,
            krakUrl: raw.krakUrl,
          } satisfies KrakLookupResult);
        }
      }
    } catch (err) {
      // 403 / CAPTCHA / timeout / DOM change — never crash the run; record a miss.
      log.warning(
        `[krak] lookup failed for "${company.name}": ${err instanceof Error ? err.message : String(err)}`,
      );
      await pushData(unmatched(company));
    }

    // Wait 2s between companies to avoid being blocked (maxConcurrency is 1).
    await page.waitForTimeout(2_000);
  };
}
