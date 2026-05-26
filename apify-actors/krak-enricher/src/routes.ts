import { type PlaywrightCrawlingContext, type RequestOptions } from "crawlee";
import type { KrakCompanyInput, KrakLookupResult } from "./shared/types.js";
import { normalizeDanishPhone } from "./shared/utils.js";

const BASE_URL = "https://www.krak.dk";

// Build one search request per company, carrying the company in userData so the
// handler can match + echo back its id. Searching by name and (when known) city
// narrows results and reduces false positives.
export function lookupStartRequests(
  companies: KrakCompanyInput[],
): RequestOptions[] {
  return companies.map((company) => {
    const what = company.name;
    const where = company.city ?? "";
    // RECON TODO: confirm Krak's search URL shape against the live site. As of
    // writing the public search is roughly `/search?what=<term>&where=<city>`;
    // it may instead be a path like `/<what>/<where>/firmaer`. Verify and adjust.
    const u = new URL("/search", BASE_URL);
    u.searchParams.set("what", what);
    if (where) u.searchParams.set("where", where);
    return {
      url: u.toString(),
      label: "LOOKUP",
      userData: { company },
    };
  });
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
// Requires either an exact match, or the shorter (substantial) name to appear as
// a whole-token run inside the other.
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
      // Let the result list settle. Krak is JS-heavy; networkidle + a short grace.
      await page
        .waitForLoadState("networkidle", { timeout: 30_000 })
        .catch(() => {});
      await page.waitForTimeout(1_000);

      // RECON TODO: the selectors below are a BEST GUESS and MUST be verified
      // against live krak.dk before scrape mode is trusted. They read the top
      // business result card: company name, phone (tel: link preferred), and any
      // listed contact person + title. Defensive — any miss yields null, which
      // (via the conservative match) becomes matched:false rather than bad data.
      const raw = await page.evaluate((): RawKrak => {
        const pick = (sels: string[]): Element | null => {
          for (const s of sels) {
            const el = document.querySelector(s);
            if (el) return el;
          }
          return null;
        };
        const text = (el: Element | null): string | null => {
          const t = el?.textContent?.trim();
          return t && t.length ? t : null;
        };

        // First result card.
        const card = pick([
          "[data-testid='result-item']",
          ".result-item",
          "article.search-result",
          "li.result",
          "ol.results > li",
        ]);
        const scope: ParentNode = card ?? document;

        const resultName = text(
          scope.querySelector(
            "[data-testid='company-name'], h2 a, h2, .company-name, .result-title",
          ),
        );

        // Phone: prefer a tel: link, then a labelled phone element.
        const telLink = scope.querySelector(
          "a[href^='tel:']",
        ) as HTMLAnchorElement | null;
        const phoneRaw =
          telLink?.getAttribute("href")?.replace(/^tel:/, "")?.trim() ||
          text(scope.querySelector("[data-testid='phone'], .phone, .tlf"));

        const contactPerson = text(
          scope.querySelector(
            "[data-testid='contact-person'], .contact-person, .contact-name",
          ),
        );
        const contactTitle = text(
          scope.querySelector(
            "[data-testid='contact-title'], .contact-title, .contact-role",
          ),
        );

        const link = scope.querySelector(
          "h2 a, a[data-testid='company-link']",
        ) as HTMLAnchorElement | null;
        const krakUrl = link?.href ?? null;

        return { resultName, phoneRaw, contactPerson, contactTitle, krakUrl };
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
