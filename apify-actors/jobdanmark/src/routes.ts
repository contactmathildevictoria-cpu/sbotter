import { type CheerioCrawlingContext } from "crawlee";
import type { ScrapedListing } from "./shared/types.js";
import { normalizeDanishPhone, normalizeDate, stripHtml } from "./shared/utils.js";

const BASE_URL = "https://www.jobdanmark.dk";

/** Build the search start URL(s). Pagination is followed by the handler. */
export function searchStartUrls({ searchString }: { searchString: string }) {
  const u = new URL("/jobsoegning", BASE_URL);
  if (searchString) u.searchParams.set("q", searchString);
  return [{ url: u.toString(), label: "LIST" as const }];
}

// RECON TODO: field accessors must be verified against the live DOM. JobDanmark
// frequently exposes a contact email/phone directly on listings — capture them
// into contactEmail / contactPhone (carried through to job_postings.raw).
export type RawJobdanmarkListing = {
  externalId: string;
  title: string;
  descriptionHtml: string | null;
  url: string;
  companyName: string;
  companyUrl: string | null;
  city: string | null;
  postedAtRaw: string | null;
  deadlineRaw: string | null;
  employmentType: string | null;
  contactEmailRaw: string | null;
  contactPhoneRaw: string | null;
};

export function mapListing(raw: RawJobdanmarkListing): ScrapedListing {
  return {
    externalId: raw.externalId,
    title: raw.title.trim(),
    description: stripHtml(raw.descriptionHtml),
    category: null,
    url: raw.url,
    postedAt: normalizeDate(raw.postedAtRaw),
    expiresAt: normalizeDate(raw.deadlineRaw),
    employmentType: raw.employmentType,
    contactEmail: raw.contactEmailRaw?.trim() || null,
    contactPhone: normalizeDanishPhone(raw.contactPhoneRaw),
    location: { city: raw.city, region: null, country: "DK" },
    company: {
      name: raw.companyName.trim(),
      cvr: null,
      website: raw.companyUrl,
      description: null,
    },
  };
}

export function createJobdanmarkHandler({ maxItems }: { maxItems: number }) {
  // RECON PENDING — first implementation step is live DOM inspection.
  // Follow-up plan:
  //   1. Inspect https://www.jobdanmark.dk/jobsoegning: listing-card selector +
  //      title / company / location / detail-link.
  //   2. On the detail page, capture the contact email + phone JobDanmark exposes.
  //   3. Build RawJobdanmarkListing → mapListing() → pushData; stop at maxItems.
  //   4. Follow pagination until maxItems / no next page.
  return async ({ request, log }: CheerioCrawlingContext) => {
    log.warning(
      `[jobdanmark] scrape handler not implemented yet (recon pending). ` +
        `Loaded ${request.loadedUrl}; maxItems=${maxItems}; pushed 0 items. ` +
        `Use fixture mode for end-to-end pipeline testing.`,
    );
  };
}
