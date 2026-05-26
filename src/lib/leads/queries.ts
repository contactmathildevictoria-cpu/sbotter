import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";
import {
  PAGE_SIZE,
  type LeadFilters,
  sinceToCutoffISO,
} from "@/lib/leads/filters";

export type CompanyRow = Database["public"]["Tables"]["companies"]["Row"];
export type JobRow = Database["public"]["Tables"]["job_postings"]["Row"];

export type CompaniesPage = {
  rows: CompanyRow[];
  total: number;
  page: number;
  pageSize: number;
};

export type JobsPage = {
  rows: (JobRow & { company: Pick<CompanyRow, "id" | "name" | "slug"> | null })[];
  total: number;
  page: number;
  pageSize: number;
};

export async function fetchCompanies(
  filters: LeadFilters,
): Promise<CompaniesPage> {
  const supabase = await createSupabaseServerClient();
  const cutoff = sinceToCutoffISO(filters.since);

  // category filter on Companies tab = "has an active job in this category"
  let categoryIds: string[] | null = null;
  if (filters.category) {
    const { data: companyIds } = await supabase
      .from("job_postings")
      .select("company_id")
      .eq("category", filters.category)
      .eq("is_active", true);
    categoryIds = Array.from(
      new Set((companyIds ?? []).map((r) => r.company_id)),
    );
    if (categoryIds.length === 0) {
      return {
        rows: [],
        total: 0,
        page: 1,
        pageSize: filters.perPage === "all" ? 0 : filters.perPage,
      };
    }
  }

  // A fresh filtered query each call — Supabase builders are single-use once
  // awaited, and the "all" path below needs to issue several ranged requests.
  const buildQuery = () => {
    let q = supabase
      .from("companies")
      .select("*", { count: "exact" })
      .gte("open_jobs_count", filters.minOpenJobs)
      .order("last_seen_at", { ascending: false });
    if (filters.q) q = q.ilike("name", `%${filters.q}%`);
    if (filters.city) q = q.ilike("location_city", filters.city);
    if (filters.country) q = q.eq("country", filters.country);
    if (cutoff) q = q.gte("last_seen_at", cutoff);
    if (categoryIds) q = q.in("id", categoryIds);
    return q;
  };

  // "All": page through in chunks (a single response is capped at ~1000 rows).
  if (filters.perPage === "all") {
    const CHUNK = 1000;
    const rows: CompanyRow[] = [];
    let total = 0;
    for (let from = 0; ; from += CHUNK) {
      const { data, count, error } = await buildQuery().range(
        from,
        from + CHUNK - 1,
      );
      if (error) throw error;
      if (typeof count === "number") total = count;
      if (!data || data.length === 0) break;
      rows.push(...data);
      if (rows.length >= total || data.length < CHUNK) break;
    }
    return { rows, total, page: 1, pageSize: rows.length };
  }

  const pageSize = filters.perPage;
  const from = (filters.page - 1) * pageSize;
  const to = from + pageSize - 1;
  const { data, count, error } = await buildQuery().range(from, to);
  if (error) throw error;

  return {
    rows: data ?? [],
    total: count ?? 0,
    page: filters.page,
    pageSize,
  };
}

export async function fetchJobs(filters: LeadFilters): Promise<JobsPage> {
  const supabase = await createSupabaseServerClient();
  const from = (filters.page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;
  const cutoff = sinceToCutoffISO(filters.since);

  let query = supabase
    .from("job_postings")
    .select("*, company:companies(id, name, slug)", { count: "exact" })
    .eq("is_active", true)
    .order("posted_at", { ascending: false, nullsFirst: false })
    .range(from, to);

  if (filters.q) {
    query = query.ilike("title", `%${filters.q}%`);
  }
  if (filters.city) {
    query = query.ilike("location_city", filters.city);
  }
  if (filters.country) {
    query = query.eq("country", filters.country);
  }
  if (filters.category) {
    query = query.eq("category", filters.category);
  }
  if (cutoff) {
    query = query.gte("posted_at", cutoff);
  }
  if (filters.sources.length > 0) {
    query = query.in("source_id", filters.sources);
  }

  const { data, count, error } = await query;
  if (error) throw error;

  return {
    rows: (data ?? []) as JobsPage["rows"],
    total: count ?? 0,
    page: filters.page,
    pageSize: PAGE_SIZE,
  };
}

export async function fetchDistinctCities(): Promise<string[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("companies")
    .select("location_city")
    .not("location_city", "is", null)
    .order("location_city", { ascending: true })
    .limit(500);
  if (error) return [];
  const cities = new Set<string>();
  for (const row of data ?? []) {
    if (row.location_city) cities.add(row.location_city);
  }
  return Array.from(cities);
}

export async function fetchActiveDataSources(): Promise<
  { id: string; name: string }[]
> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("data_sources")
    .select("id, name")
    .eq("active", true)
    .order("name");
  if (error) return [];
  return data ?? [];
}
