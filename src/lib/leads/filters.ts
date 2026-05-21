export type SinceKey = "24h" | "7d" | "30d" | "any";

export type LeadView = "companies" | "jobs";

export type LeadFilters = {
  q: string;
  city: string | null;
  country: string | null;
  category: string | null;
  since: SinceKey;
  minOpenJobs: number;
  sources: string[];
  page: number;
};

export const CATEGORIES = ["marketing", "sales", "tech", "ops", "other"] as const;
export const COUNTRIES = ["DK", "SE", "NO", "DE"] as const;
export const PAGE_SIZE = 25;

export const DEFAULT_FILTERS: LeadFilters = {
  q: "",
  city: null,
  country: null,
  category: null,
  since: "any",
  minOpenJobs: 1,
  sources: [],
  page: 1,
};

type RawSearchParams = Record<string, string | string[] | undefined>;

function readOne(params: RawSearchParams, key: string): string | null {
  const value = params[key];
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function readMany(params: RawSearchParams, key: string): string[] {
  const value = params[key];
  if (!value) return [];
  if (Array.isArray(value)) return value.flatMap((v) => v.split(","));
  return value.split(",").filter(Boolean);
}

export function parseFiltersFromSearchParams(
  searchParams: RawSearchParams,
): LeadFilters {
  const since = (readOne(searchParams, "since") as SinceKey | null) ?? "any";
  const minOpenJobsRaw = Number(readOne(searchParams, "min_open_jobs") ?? "1");
  const pageRaw = Number(readOne(searchParams, "page") ?? "1");

  return {
    q: readOne(searchParams, "q") ?? "",
    city: readOne(searchParams, "city"),
    country: readOne(searchParams, "country"),
    category: readOne(searchParams, "category"),
    since: (["24h", "7d", "30d", "any"] as const).includes(since) ? since : "any",
    minOpenJobs: Number.isFinite(minOpenJobsRaw)
      ? Math.max(1, Math.min(10, Math.trunc(minOpenJobsRaw)))
      : 1,
    sources: readMany(searchParams, "sources"),
    page: Number.isFinite(pageRaw) ? Math.max(1, Math.trunc(pageRaw)) : 1,
  };
}

export function filtersToSearchString(filters: LeadFilters): string {
  const params = new URLSearchParams();
  if (filters.q) params.set("q", filters.q);
  if (filters.city) params.set("city", filters.city);
  if (filters.country) params.set("country", filters.country);
  if (filters.category) params.set("category", filters.category);
  if (filters.since !== "any") params.set("since", filters.since);
  if (filters.minOpenJobs > 1)
    params.set("min_open_jobs", String(filters.minOpenJobs));
  if (filters.sources.length > 0) params.set("sources", filters.sources.join(","));
  if (filters.page > 1) params.set("page", String(filters.page));
  const s = params.toString();
  return s ? `?${s}` : "";
}

export function sinceToCutoffISO(since: SinceKey): string | null {
  if (since === "any") return null;
  const ms =
    since === "24h"
      ? 24 * 60 * 60 * 1000
      : since === "7d"
        ? 7 * 24 * 60 * 60 * 1000
        : 30 * 24 * 60 * 60 * 1000;
  return new Date(Date.now() - ms).toISOString();
}
