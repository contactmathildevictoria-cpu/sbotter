import { type PlaywrightCrawlingContext } from "crawlee";
import type { ScrapedListing } from "./shared/types.js";
import { normalizeDate, stripHtml } from "./shared/utils.js";

const BASE_URL = "https://www.randstad.dk";

/** Fallback company name when Randstad hides the hiring client (confidential). */
export const CONFIDENTIAL_COMPANY = "Fortrolig (via Randstad)";

/** Build the search start URL(s). Pagination is followed by the handler. */
export function searchStartUrls({ searchString }: { searchString: string }) {
  const u = new URL("/jobs/", BASE_URL);
  if (searchString) u.searchParams.set("q", searchString);
  return [{ url: u.toString(), label: "LIST" as const }];
}

// RECON TODO: verify accessors live. Randstad is a staffing agency — the hiring
// CLIENT is the lead, not Randstad. `clientCompanyName` is null when the client
// is confidential ("fortrolig"); mapListing substitutes CONFIDENTIAL_COMPANY.
export type RawRandstadListing = {
  externalId: string;
  title: string;
  descriptionHtml: string | null;
  url: string;
  clientCompanyName: string | null;
  city: string | null;
  postedAtRaw: string | null;
  deadlineRaw: string | null;
  employmentType: string | null;
};

export function mapListing(raw: RawRandstadListing): ScrapedListing {
  const name = raw.clientCompanyName?.trim() || CONFIDENTIAL_COMPANY;
  return {
    externalId: raw.externalId,
    title: raw.title.trim(),
    description: stripHtml(raw.descriptionHtml),
    category: null,
    url: raw.url,
    postedAt: normalizeDate(raw.postedAtRaw),
    expiresAt: normalizeDate(raw.deadlineRaw),
    employmentType: raw.employmentType,
    location: { city: raw.city, region: null, country: "DK" },
    company: {
      // The client's own website is never the randstad.dk posting URL, so leave
      // website null — CVR/website enrichment fills contacts later.
      name,
      cvr: null,
      website: null,
      description: null,
    },
  };
}

export function createRandstadHandler({ maxItems }: { maxItems: number }) {
  // RECON PENDING — first implementation step is live inspection.
  // Follow-up plan:
  //   1. Inspect randstad.dk/jobs/ — SSR or SPA? Find listing + detail selectors.
  //   2. Extract the CLIENT company name (not "Randstad"); when hidden, leave
  //      clientCompanyName null so mapListing uses CONFIDENTIAL_COMPANY. Note:
  //      all confidential postings then dedup into one company row (acceptable v1).
  //   3. mapListing(raw) → pushData; stop at maxItems.
  //   4. Follow pagination / load-more until maxItems.
  return async ({ request, log }: PlaywrightCrawlingContext) => {
    log.warning(
      `[randstad] scrape handler not implemented yet (recon pending). ` +
        `Loaded ${request.loadedUrl}; maxItems=${maxItems}; pushed 0 items. ` +
        `Use fixture mode for end-to-end pipeline testing.`,
    );
  };
}
