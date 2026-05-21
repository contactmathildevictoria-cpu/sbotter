import { createCheerioRouter, Dataset, log } from "crawlee";

export const router = createCheerioRouter();

// Selectors are best-guess for the current Jobnet.dk markup and should be
// confirmed by inspecting the actual page before relying on production scrapes.
const SELECTORS = {
  searchResultLink: "a.job-ad-summary__link, a[href*='/CV/FindWork/Details/']",
  detailTitle: "h1.job-ad-detail__title, h1",
  detailCompany: ".job-ad-detail__company-name, .company-name",
  detailLocation: ".job-ad-detail__location, .location",
  detailDescription: ".job-ad-detail__description, .description",
  detailPostedAt: "[data-published-at], time[datetime]",
};

router.addDefaultHandler(async ({ $, request, enqueueLinks }) => {
  log.info(`crawling search results: ${request.url}`);
  const links: string[] = [];
  $(SELECTORS.searchResultLink).each((_, el) => {
    const href = $(el).attr("href");
    if (href) links.push(href.startsWith("http") ? href : `https://job.jobnet.dk${href}`);
  });
  log.info(`found ${links.length} job links`);
  await enqueueLinks({
    urls: links,
    label: "DETAIL",
  });
});

router.addHandler("DETAIL", async ({ $, request }) => {
  const externalId = request.url.split("/").filter(Boolean).pop() ?? request.url;
  const title = $(SELECTORS.detailTitle).first().text().trim();
  const companyName = $(SELECTORS.detailCompany).first().text().trim();
  const location = $(SELECTORS.detailLocation).first().text().trim();
  const description = $(SELECTORS.detailDescription).first().text().trim();
  const postedAt =
    $(SELECTORS.detailPostedAt).first().attr("datetime") ??
    $(SELECTORS.detailPostedAt).first().attr("data-published-at") ??
    null;

  if (!title || !companyName) {
    log.warning(`skipping ${request.url} — missing title or company`);
    return;
  }

  await Dataset.pushData({
    externalId,
    title,
    description,
    category: null,
    url: request.url,
    postedAt,
    expiresAt: null,
    location: {
      city: location || null,
      region: null,
      country: "DK",
    },
    company: {
      name: companyName,
      cvr: null,
      website: null,
      description: null,
    },
  });
});
