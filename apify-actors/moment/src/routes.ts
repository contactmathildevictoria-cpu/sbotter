import { type PlaywrightCrawlingContext } from "crawlee";
import type { ScrapedListing } from "./shared/types.js";
import { normalizeDate, stripHtml } from "./shared/utils.js";

// Moment is now part of The Hub. Danish jobs live at /jobs/location/denmark and
// paginate with ?page=N.
const BASE_URL = "https://thehub.io";

/** Build the search start URL(s). Pagination (?page=N) is followed by the handler. */
export function searchStartUrls({ searchString }: { searchString: string }) {
  const u = new URL("/jobs/location/denmark", BASE_URL);
  if (searchString) u.searchParams.set("search", searchString);
  return [{ url: u.toString(), label: "LIST" as const }];
}

// RECON TODO: confirm field accessors against the live SPA (or its JSON API, if
// one backs the listing grid — prefer that over DOM scraping, like Jobnet's BFF).
export type RawMomentListing = {
  externalId: string; // slug/id from the detail URL
  title: string;
  descriptionHtml: string | null;
  url: string;
  companyName: string;
  companyUrl: string | null;
  city: string | null;
  postedAtRaw: string | null;
  employmentType: string | null;
};

export function mapListing(raw: RawMomentListing): ScrapedListing {
  return {
    externalId: raw.externalId,
    title: raw.title.trim(),
    description: stripHtml(raw.descriptionHtml),
    category: null,
    url: raw.url,
    postedAt: normalizeDate(raw.postedAtRaw),
    expiresAt: null,
    employmentType: raw.employmentType,
    location: { city: raw.city, region: null, country: "DK" },
    company: {
      name: raw.companyName.trim(),
      cvr: null,
      website: raw.companyUrl,
      description: null,
    },
  };
}

export function createMomentHandler({ maxItems }: { maxItems: number }) {
  // RECON PENDING — first implementation step is live inspection.
  // Follow-up plan:
  //   1. Check thehub.io/jobs/location/denmark — is there a backing JSON API
  //      (preferred) or must we render the React grid? Find listing + detail
  //      selectors / API fields.
  //   2. Build RawMomentListing → mapListing() → pushData. Startups/scaleups
  //      rarely expose a CVR → company dedup falls back to domain/slug (fine).
  //   3. Paginate (?page=N or infinite scroll) until maxItems.
  return async ({ request, log }: PlaywrightCrawlingContext) => {
    log.warning(
      `[moment] scrape handler not implemented yet (recon pending). ` +
        `Loaded ${request.loadedUrl}; maxItems=${maxItems}; pushed 0 items. ` +
        `Use fixture mode for end-to-end pipeline testing.`,
    );
  };
}
