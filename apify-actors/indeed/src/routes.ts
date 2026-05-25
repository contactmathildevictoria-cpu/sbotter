import { type PlaywrightCrawlingContext } from "crawlee";
import type { ScrapedListing } from "./shared/types.js";
import { normalizeDate, stripHtml } from "./shared/utils.js";

const BASE_URL = "https://dk.indeed.com";

/** Build the search start URL(s). Indeed paginates with &start=10,20,… (10/page). */
export function searchStartUrls({
  searchString,
  location,
}: {
  searchString: string;
  location: string;
}) {
  const u = new URL("/jobs", BASE_URL);
  u.searchParams.set("q", searchString);
  u.searchParams.set("l", location);
  return [{ url: u.toString(), label: "LIST" as const }];
}

// RECON TODO: Indeed's markup changes often and is anti-bot guarded. Field
// accessors must be verified live. `postedAtRaw` is typically relative
// ("Active 3 days ago", "30+ days ago") → normalizeDate handles that.
export type RawIndeedListing = {
  jk: string; // Indeed job key (jk= in the URL) — stable externalId
  title: string;
  descriptionHtml: string | null;
  url: string;
  companyName: string;
  companyUrl: string | null;
  city: string | null;
  postedAtRaw: string | null;
  employmentType: string | null;
};

export function mapListing(raw: RawIndeedListing): ScrapedListing {
  return {
    externalId: raw.jk,
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

export function createIndeedHandler({ maxItems }: { maxItems: number }) {
  // RECON PENDING — live inspection + anti-bot iteration is the first step.
  // Follow-up plan:
  //   1. Inspect dk.indeed.com/jobs result cards; capture jk=, title, company,
  //      location, snippet. Click through (or fetch the detail) for the full
  //      description + employment type.
  //   2. Use realistic User-Agent + random 2–5s delays; on CAPTCHA, SKIP the
  //      listing and continue (never crash the run).
  //   3. mapListing(raw) → pushData; stop at maxItems.
  //   4. Paginate with &start=10,20,… until maxItems / no results.
  return async ({ request, log }: PlaywrightCrawlingContext) => {
    log.warning(
      `[indeed] scrape handler not implemented yet (recon pending). ` +
        `Loaded ${request.loadedUrl}; maxItems=${maxItems}; pushed 0 items. ` +
        `Use fixture mode for end-to-end pipeline testing.`,
    );
  };
}
