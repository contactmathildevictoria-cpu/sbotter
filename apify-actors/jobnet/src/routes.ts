import { Dataset, type PlaywrightCrawlingContext } from "crawlee";
import { stripHtml } from "./shared/utils.js";

// Jobnet.dk is a Next.js + Relay SPA. The public job-search data is served by a
// JSON BFF endpoint that the page calls after load:
//
//   GET https://jobnet.dk/bff/FindJob/Search
//       ?resultsPerPage=&pageNumber=&orderType=BestMatch&kmRadius=50&searchString=
//
// It rejects anonymous requests (401) unless they carry the session cookie set
// when the SPA loads AND an `x-csrf: 1` header. So we load /find-job once in a
// real browser to establish the session, then call the endpoint ourselves and
// paginate. No DOM scraping — the API returns clean, structured ads.

const SEARCH_PATH = "/bff/FindJob/Search";
const RESULTS_PER_PAGE = 50;

type JobAd = {
  jobAdId: string;
  title: string;
  description: string | null;
  hiringOrgName: string;
  cvr: string | null;
  country: string | null;
  municipality: string | null;
  postalDistrictName: string | null;
  postalCode: number | null;
  publicationDate: string | null;
  applicationDeadline: string | null;
  occupation: string | null;
  isExternal: boolean;
  jobAdUrl: string;
};

type SearchResponse = {
  jobAds: JobAd[];
  totalJobAdCount: number;
};

// Map a raw Jobnet BFF ad into the unified shape consumed by
// src/lib/ingest/normalize.ts (jobnetItemSchema) in the Spotter app.
export function mapJobAd(ad: JobAd) {
  return {
    externalId: ad.jobAdId,
    title: ad.title?.trim(),
    description: stripHtml(ad.description),
    // Leave null so the server-side normalizer infers a category from the title.
    category: null as string | null,
    url: `https://jobnet.dk/find-job/${ad.jobAdId}`,
    postedAt: ad.publicationDate || null,
    expiresAt: ad.applicationDeadline || null,
    location: {
      city: ad.postalDistrictName || ad.municipality || null,
      region: ad.municipality || null,
      country: ad.country === "Danmark" ? "DK" : ad.country || "DK",
    },
    company: {
      name: ad.hiringOrgName?.trim(),
      cvr: ad.cvr || null,
      website: null as string | null,
      description: null as string | null,
    },
  };
}

export type ScrapeOptions = {
  searchString: string;
  maxItems: number;
  orderType: string;
};

export function createJobnetSearchHandler({
  searchString,
  maxItems,
  orderType,
}: ScrapeOptions) {
  return async ({ page, log }: PlaywrightCrawlingContext) => {
    // The session cookie is set by navigating to /find-job (done by the crawler
    // before this handler runs). Give the SPA a moment to settle.
    await page.waitForTimeout(1500);

    let pushed = 0;
    let pageNumber = 1;
    let total = Number.POSITIVE_INFINITY;

    while (pushed < maxItems && (pageNumber - 1) * RESULTS_PER_PAGE < total) {
      const query = new URLSearchParams({
        resultsPerPage: String(RESULTS_PER_PAGE),
        pageNumber: String(pageNumber),
        orderType,
        kmRadius: "50",
        searchString,
      });
      const url = `${SEARCH_PATH}?${query.toString()}`;

      // Call the BFF from inside the page so the session cookie is sent.
      const result = await page.evaluate(async (u): Promise<{
        status: number;
        body: SearchResponse | null;
      }> => {
        const res = await fetch(u, {
          headers: { "x-csrf": "1", "content-type": "application/json" },
        });
        return { status: res.status, body: res.ok ? await res.json() : null };
      }, url);

      if (result.status !== 200 || !result.body) {
        log.warning(`Search page ${pageNumber} returned ${result.status}; stopping.`);
        break;
      }

      total = result.body.totalJobAdCount ?? total;
      const ads = result.body.jobAds ?? [];
      if (ads.length === 0) break;

      const items = ads
        .map(mapJobAd)
        .filter((it) => it.company.name && it.title && it.externalId);
      const slice = items.slice(0, maxItems - pushed);
      await Dataset.pushData(slice);
      pushed += slice.length;

      log.info(
        `page ${pageNumber}: pushed ${slice.length} ads (${pushed}/${maxItems}, ${total} available)`,
      );
      pageNumber += 1;
    }

    log.info(`Scrape complete — ${pushed} ads pushed to dataset.`);
  };
}
