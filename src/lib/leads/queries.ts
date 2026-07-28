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

// ============================================================
// Daily list / CRM board
// ============================================================

export type LeadAssignmentRow =
  Database["public"]["Tables"]["lead_assignments"]["Row"];

/** The company fields a lead card renders. */
export type BoardCompany = Pick<
  CompanyRow,
  | "id"
  | "name"
  | "slug"
  | "website"
  | "location_city"
  | "country"
  | "industry"
  | "cvr_industry_text"
  | "open_jobs_count"
  | "phone"
  | "email"
  | "contact_person_name"
  | "website_phone"
  | "website_email"
  | "website_contact_person"
  | "website_contact_title"
  | "krak_phone"
  | "krak_contact_person"
  | "krak_contact_title"
>;

export type BoardLead = Pick<
  LeadAssignmentRow,
  | "id"
  | "company_id"
  | "list_date"
  | "origin"
  | "status"
  | "rating"
  | "note"
  | "follow_up_at"
  | "in_trash"
> & { company: BoardCompany | null };

/** Newest-first cap. Closed leads are never trashed, so the board can grow. */
const BOARD_LIMIT = 500;

/**
 * Every lead currently on the user's board, across all list dates.
 *
 * The `.or` is deliberate. `status = 'no_pickup'` implies `in_trash = true`,
 * so filtering on `in_trash = false` alone would leave the board's follow-up
 * column permanently empty. Letting exactly those rows through turns the trash
 * into a visible "waiting to come back" column with its follow-up date.
 */
export async function fetchBoardLeads(userId: string): Promise<BoardLead[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("lead_assignments")
    .select(
      `id, company_id, list_date, origin, status, rating, note, follow_up_at, in_trash,
       company:companies (
         id, name, slug, website, location_city, country, industry,
         cvr_industry_text, open_jobs_count,
         phone, email, contact_person_name,
         website_phone, website_email, website_contact_person, website_contact_title,
         krak_phone, krak_contact_person, krak_contact_title
       )`,
    )
    .eq("user_id", userId)
    .or("in_trash.eq.false,status.eq.no_pickup")
    .order("list_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(BOARD_LIMIT);

  if (error) throw error;
  // database.ts is hand-written, so embedded-relation inference needs the same
  // escape hatch fetchJobs already uses.
  return (data ?? []) as unknown as BoardLead[];
}

export type ListPreferencesValues = {
  dailyTarget: number;
  trashMax: number;
  followUpDays: number;
};

export const DEFAULT_LIST_PREFERENCES: ListPreferencesValues = {
  dailyTarget: 50,
  trashMax: 10,
  followUpDays: 7,
};

export async function fetchListPreferences(
  userId: string,
): Promise<ListPreferencesValues> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("list_preferences")
    .select("daily_target, trash_max, follow_up_days")
    .eq("user_id", userId)
    .maybeSingle();

  if (!data) return DEFAULT_LIST_PREFERENCES;
  return {
    dailyTarget: data.daily_target,
    trashMax: data.trash_max,
    followUpDays: data.follow_up_days,
  };
}

export async function fetchExcludedCompanies(
  userId: string,
): Promise<{ id: string; name: string; name_normalized: string }[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("excluded_companies")
    .select("id, name, name_normalized")
    .eq("user_id", userId)
    .order("name", { ascending: true })
    .limit(2000);
  if (error) return [];
  return data ?? [];
}

export async function fetchBlockedIndustries(
  userId: string,
): Promise<{ industry_code: number; industry_label: string }[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("blocked_industries")
    .select("industry_code, industry_label")
    .eq("user_id", userId)
    .order("industry_label", { ascending: true })
    .limit(500);
  if (error) return [];
  return data ?? [];
}

/**
 * The industries that actually occur in the pool, so the settings combobox
 * offers real choices instead of the full DB07 catalogue.
 */
export async function fetchIndustryOptions(): Promise<
  { code: number; label: string }[]
> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("companies")
    .select("cvr_industry_code, cvr_industry_text")
    .not("cvr_industry_code", "is", null)
    .order("cvr_industry_text", { ascending: true })
    .limit(2000);
  if (error) return [];

  const byCode = new Map<number, string>();
  for (const row of data ?? []) {
    if (row.cvr_industry_code === null) continue;
    if (byCode.has(row.cvr_industry_code)) continue;
    byCode.set(
      row.cvr_industry_code,
      row.cvr_industry_text ?? String(row.cvr_industry_code),
    );
  }
  return Array.from(byCode, ([code, label]) => ({ code, label })).sort((a, b) =>
    a.label.localeCompare(b.label, "da"),
  );
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
