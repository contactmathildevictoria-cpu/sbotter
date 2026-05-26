import { type CheerioCrawlingContext } from "crawlee";
import type { ScrapedListing } from "./shared/types.js";
import { normalizeDate, stripHtml } from "./shared/utils.js";

// Jobindex.dk search results live at /jobsoegning and paginate with ?page=N.
const BASE_URL = "https://www.jobindex.dk";

/** Build the search start URL(s). Pagination (?page=N) is followed by the handler. */
export function searchStartUrls({
  searchString,
  location,
}: {
  searchString: string;
  location: string;
}) {
  const u = new URL("/jobsoegning", BASE_URL);
  if (searchString) u.searchParams.set("q", searchString);
  // TODO(recon): confirm the real location query param name on jobindex.
  if (location) u.searchParams.set("geoareaid", location);
  return [{ url: u.toString(), label: "LIST" as const }];
}

// RECON TODO: the exact fields/selectors are unknown until we inspect the live
// DOM. This type documents the intended raw → ScrapedListing contract; the
// accessors that produce it must be verified against the real markup.
export type RawJobindexListing = {
  externalId: string; // job number from /jobannonce/<id> URL
  title: string;
  descriptionHtml: string | null;
  url: string;
  companyName: string;
  companyUrl: string | null;
  city: string | null;
  postedAtRaw: string | null;
  deadlineRaw: string | null;
  employmentType: string | null;
};

export function mapListing(raw: RawJobindexListing): ScrapedListing {
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
      name: raw.companyName.trim(),
      cvr: null,
      website: raw.companyUrl,
      description: null,
    },
  };
}

export function createJobindexHandler({ maxItems }: { maxItems: number }) {
  // RECON PENDING — live DOM inspection is the first implementation step.
  // Follow-up plan:
  //   1. Inspect https://www.jobindex.dk/jobsoegning: find the listing-card
  //      selector and its title / company / location / detail-link sub-selectors.
  //   2. Build RawJobindexListing per card (enqueue the detail page for the full
  //      description + deadline + employment type + company URL).
  //   3. mapListing(raw) → context.pushData; stop once maxItems is reached.
  //   4. Follow ?page=N pagination (enqueueLinks on the "next" control) until
  //      maxItems or no more pages.
  return async ({ request, log }: CheerioCrawlingContext) => {
    log.warning(
      `[jobindex] scrape handler not implemented yet (recon pending). ` +
        `Loaded ${request.loadedUrl}; maxItems=${maxItems}; pushed 0 items. ` +
        `Use fixture mode for end-to-end pipeline testing.`,
    );
  };
}
