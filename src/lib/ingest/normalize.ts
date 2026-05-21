import { z } from "zod";

export const jobnetItemSchema = z.object({
  externalId: z.string().min(1),
  title: z.string().min(1),
  description: z.string().nullable().optional(),
  category: z.string().nullable().optional(),
  url: z.string().url(),
  postedAt: z.string().nullable().optional(),
  expiresAt: z.string().nullable().optional(),
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
  sourceId: "jobnet";
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

export function normalizeJobnetItem(raw: unknown): NormalizedJob {
  const item = jobnetItemSchema.parse(raw);
  const companyName = item.company.name.trim();
  const slug = slugify(companyName);
  const domain = extractDomain(item.company.website ?? null);

  return {
    sourceId: "jobnet",
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
      website: item.company.website ?? null,
      domain,
      description: item.company.description ?? null,
      locationCity: item.location?.city ?? null,
      locationRegion: item.location?.region ?? null,
      country: item.location?.country ?? "DK",
    },
  };
}
