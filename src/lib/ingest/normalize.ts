import { z } from "zod";

// The set of job sources we ingest. Each has a custom Apify Actor under
// apify-actors/<id>/ that POSTs to /api/ingest/apify?source=<id>. This is the
// single source of truth — the ingest route's allowlist is derived from it.
export type SourceId =
  | "jobnet"
  | "jobindex"
  | "jobdanmark"
  | "indeed"
  | "moment"
  | "randstad";

export const SOURCE_IDS: ReadonlySet<SourceId> = new Set<SourceId>([
  "jobnet",
  "jobindex",
  "jobdanmark",
  "indeed",
  "moment",
  "randstad",
]);

// Every Actor emits this same shape (see apify-actors/shared/src/types.ts). The
// trailing employmentType / contactEmail / contactPhone fields are optional —
// only some sources provide them (e.g. Jobdanmark). They're preserved on the
// posting's `raw` jsonb; we don't map them onto company contact columns (those
// belong to the CVR / website-scrape enrichment pipelines).
export const jobnetItemSchema = z.object({
  externalId: z.string().min(1),
  title: z.string().min(1),
  description: z.string().nullable().optional(),
  category: z.string().nullable().optional(),
  url: z.string().url(),
  postedAt: z.string().nullable().optional(),
  expiresAt: z.string().nullable().optional(),
  employmentType: z.string().nullable().optional(),
  contactEmail: z.string().nullable().optional(),
  contactPhone: z.string().nullable().optional(),
  location: z
    .object({
      city: z.string().nullable().optional(),
      region: z.string().nullable().optional(),
      country: z.string().nullable().optional(),
    })
    .optional(),
  company: z.object({
    name: z.string().min(1),
    cvr: z.string().nullable().optional(),
    website: z.string().nullable().optional(),
    description: z.string().nullable().optional(),
  }),
});

export type JobnetItem = z.infer<typeof jobnetItemSchema>;

export type NormalizedJob = {
  sourceId: SourceId;
  externalId: string;
  title: string;
  description: string | null;
  category: string | null;
  url: string;
  postedAt: string | null;
  expiresAt: string | null;
  locationCity: string | null;
  locationRegion: string | null;
  country: string | null;
  raw: unknown;
  company: NormalizedCompany;
};

export type NormalizedCompany = {
  name: string;
  slug: string;
  cvr: string | null;
  website: string | null;
  domain: string | null;
  description: string | null;
  locationCity: string | null;
  locationRegion: string | null;
  country: string | null;
};

export function slugify(input: string): string {
  return input
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96);
}

export function extractDomain(website: string | null | undefined): string | null {
  if (!website) return null;
  try {
    const url = new URL(website.startsWith("http") ? website : `https://${website}`);
    return url.hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

// Job boards / aggregators: a posting URL on one of these is NOT the company's
// own site, so we must never derive a `website` from it (otherwise every Jobnet
// lead would get website=jobnet.dk and the scraper would hammer it).
const JOB_BOARD_DOMAINS = new Set([
  "jobnet.dk",
  "jobindex.dk",
  "ofir.dk",
  "jobfinder.dk",
  "thehub.io",
  "indeed.com",
  "linkedin.com",
  "stepstone.dk",
  "glassdoor.com",
  "monster.dk",
  "google.com",
]);

function registrableDomain(hostname: string): string {
  return hostname.replace(/^www\./, "").toLowerCase().split(".").slice(-2).join(".");
}

/**
 * Derive a company website from a job-posting URL — but only when the posting
 * lives on the company's own domain, not a job board. Returns the bare origin
 * (e.g. https://firma.dk from https://firma.dk/karriere/job-123), or null for
 * job-board URLs like Jobnet's. Used as a fallback when the source didn't give
 * us an explicit company website.
 */
export function websiteFromJobUrl(jobUrl: string | null | undefined): string | null {
  if (!jobUrl) return null;
  try {
    const url = new URL(jobUrl.startsWith("http") ? jobUrl : `https://${jobUrl}`);
    if (JOB_BOARD_DOMAINS.has(registrableDomain(url.hostname))) return null;
    return `${url.protocol}//${url.hostname}`;
  } catch {
    return null;
  }
}

const CATEGORY_KEYWORDS: Array<{ key: string; patterns: RegExp[] }> = [
  { key: "marketing", patterns: [/market/i, /kommunik/i, /brand/i, /content/i] },
  { key: "sales", patterns: [/salg/i, /sales/i, /account/i, /business develop/i] },
  { key: "tech", patterns: [/udvik/i, /develop/i, /engineer/i, /software/i, /devops/i, /data/i] },
  { key: "ops", patterns: [/drift/i, /operations/i, /supply/i, /logistik/i, /hr/i, /finance/i, /økonomi/i] },
];

function inferCategory(title: string, given: string | null | undefined): string {
  if (given && given.length > 0) return given.toLowerCase();
  for (const { key, patterns } of CATEGORY_KEYWORDS) {
    if (patterns.some((p) => p.test(title))) return key;
  }
  return "other";
}

export function normalizeItem(raw: unknown, source: SourceId): NormalizedJob {
  const item = jobnetItemSchema.parse(raw);
  const companyName = item.company.name.trim();
  const slug = slugify(companyName);
  // Prefer the source-provided company website; otherwise derive it from the
  // posting URL (skipped for job-board URLs — see websiteFromJobUrl).
  const website = item.company.website ?? websiteFromJobUrl(item.url);
  const domain = extractDomain(website);

  return {
    sourceId: source,
    externalId: item.externalId,
    title: item.title.trim(),
    description: item.description ?? null,
    category: inferCategory(item.title, item.category ?? null),
    url: item.url,
    postedAt: item.postedAt ?? null,
    expiresAt: item.expiresAt ?? null,
    locationCity: item.location?.city ?? null,
    locationRegion: item.location?.region ?? null,
    country: item.location?.country ?? "DK",
    raw,
    company: {
      name: companyName,
      slug,
      cvr: item.company.cvr ?? null,
      website,
      domain,
      description: item.company.description ?? null,
      locationCity: item.location?.city ?? null,
      locationRegion: item.location?.region ?? null,
      country: item.location?.country ?? "DK",
    },
  };
}
