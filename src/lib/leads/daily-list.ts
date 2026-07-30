import "server-only";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import {
  isEligibleCandidate,
  buildEligibilityContext,
  planDailyList,
  todayInCopenhagen,
  type CandidateCompany,
  type DailyListSummary,
  type ExistingAssignment,
  type Exclusions,
  type ListPreferences,
} from "@/lib/leads/daily-list-core";

/**
 * The I/O half of the daily-list engine. All decision-making lives in
 * daily-list-core.ts; this file only reads the inputs and writes the plan.
 *
 * Uses the service client because the cron route runs it on behalf of every
 * user, with no session to borrow.
 */

/** PostgREST caps a response at ~1000 rows, so reads that can exceed it page. */
const ASSIGNMENT_PAGE = 1000;
const CANDIDATE_PAGE = 500;
/** Hard bound on the candidate scan: 20 pages x 500 = 10 000 companies. */
const MAX_CANDIDATE_PAGES = 20;
/** Stop paging once we hold this multiple of what we need, to leave slack. */
const CANDIDATE_OVERSHOOT = 3;

const DEFAULT_PREFS: ListPreferences = {
  dailyTarget: 50,
  trashMax: 10,
  followUpDays: 7,
};

type ServiceClient = ReturnType<typeof createSupabaseServiceClient>;

async function readPreferences(
  supabase: ServiceClient,
  userId: string,
): Promise<ListPreferences> {
  const { data } = await supabase
    .from("list_preferences")
    .select("daily_target, trash_max, follow_up_days")
    .eq("user_id", userId)
    // maybeSingle, never single: a missing row must not throw. handle_new_user
    // seeds it, but a user created before that migration — or on a branch that
    // hasn't been pushed yet — would otherwise break the whole run.
    .maybeSingle();

  if (!data) {
    // Self-heal so the settings page has something to edit. Errors are
    // deliberately ignored: a race here just means someone else won.
    await supabase.from("list_preferences").insert({ user_id: userId });
    return DEFAULT_PREFS;
  }

  return {
    dailyTarget: data.daily_target,
    trashMax: data.trash_max,
    followUpDays: data.follow_up_days,
  };
}

/**
 * Reads EVERY assignment row for the user. Paging here is a correctness
 * requirement, not an optimisation: a truncated read undercounts the unworked
 * leads, so the engine would over-top-up every single day for anyone who has
 * accumulated more than a page of assignments.
 */
async function readAllAssignments(
  supabase: ServiceClient,
  userId: string,
): Promise<ExistingAssignment[]> {
  const rows: ExistingAssignment[] = [];

  for (let from = 0; ; from += ASSIGNMENT_PAGE) {
    const { data, error } = await supabase
      .from("lead_assignments")
      .select("id, company_id, status, in_trash, follow_up_at, list_date, deleted_at")
      .eq("user_id", userId)
      // A unique sort key, so offset paging can't skip or repeat a row.
      .order("id", { ascending: true })
      .range(from, from + ASSIGNMENT_PAGE - 1);

    if (error) throw error;
    if (!data || data.length === 0) break;

    for (const row of data) {
      rows.push({
        id: row.id,
        companyId: row.company_id,
        status: row.status,
        inTrash: row.in_trash,
        followUpAt: row.follow_up_at,
        listDate: row.list_date,
        // Deleted rows are read on purpose: they keep the company out of the
        // fresh pool. The planner excludes them from selection.
        deletedAt: row.deleted_at,
      });
    }

    if (data.length < ASSIGNMENT_PAGE) break;
  }

  return rows;
}

async function readExclusions(
  supabase: ServiceClient,
  userId: string,
): Promise<Exclusions> {
  const [excluded, blocked] = await Promise.all([
    supabase
      .from("excluded_companies")
      .select("name_normalized, cvr, domain")
      .eq("user_id", userId)
      .limit(2000),
    supabase
      .from("blocked_industries")
      .select("industry_code")
      .eq("user_id", userId)
      .limit(500),
  ]);

  if (excluded.error) throw excluded.error;
  if (blocked.error) throw blocked.error;

  return {
    nameNormalized: (excluded.data ?? []).map((r) => r.name_normalized),
    cvrs: (excluded.data ?? [])
      .map((r) => r.cvr)
      .filter((v): v is string => Boolean(v)),
    domains: (excluded.data ?? [])
      .map((r) => r.domain)
      .filter((v): v is string => Boolean(v)),
    industryCodes: (blocked.data ?? []).map((r) => r.industry_code),
  };
}

/**
 * Pages the company pool, keeping only rows the planner would accept.
 *
 * Most of the filtering happens here in TS rather than in the query, because
 * PostgREST can't express it: the already-assigned set can run to thousands of
 * UUIDs (far past the URL length limit), and a negated group-OR for the
 * name-prefix rule isn't expressible at all. Only the two cheap, always-true
 * predicates and an industry narrowing go server-side.
 */
async function readCandidates(
  supabase: ServiceClient,
  userId: string,
  wanted: number,
  existing: readonly ExistingAssignment[],
  exclusions: Exclusions,
): Promise<CandidateCompany[]> {
  if (wanted <= 0) return [];

  const ctx = buildEligibilityContext(existing, exclusions);
  const blockedCodes = exclusions.industryCodes;
  const target = wanted * CANDIDATE_OVERSHOOT;
  const out: CandidateCompany[] = [];

  for (let page = 0; page < MAX_CANDIDATE_PAGES; page++) {
    const from = page * CANDIDATE_PAGE;
    let query = supabase
      .from("companies")
      .select(
        "id, slug, cvr, domain, cvr_industry_code, is_bankrupt, open_jobs_count, last_seen_at",
      )
      .gte("open_jobs_count", 1)
      .eq("is_bankrupt", false)
      .order("last_seen_at", { ascending: false })
      // last_seen_at is not unique; without a unique tiebreak, offset paging
      // over it can repeat or skip rows between pages.
      .order("id", { ascending: true })
      .range(from, from + CANDIDATE_PAGE - 1);

    if (blockedCodes.length > 0) {
      // The `is.null` half is mandatory. A bare NOT IN evaluates to SQL
      // `NULL NOT IN (...)` -> NULL for every company without an industry
      // code, which silently drops most of the pool. isEligibleCandidate
      // re-checks anyway, so correctness never rests on this clause.
      query = query.or(
        `cvr_industry_code.is.null,cvr_industry_code.not.in.(${blockedCodes.join(",")})`,
      );
    }

    const { data, error } = await query;
    if (error) throw error;
    if (!data || data.length === 0) break;

    for (const row of data) {
      const candidate: CandidateCompany = {
        id: row.id,
        slug: row.slug,
        cvr: row.cvr,
        domain: row.domain,
        cvrIndustryCode: row.cvr_industry_code,
        isBankrupt: row.is_bankrupt,
        openJobsCount: row.open_jobs_count,
        lastSeenAt: row.last_seen_at,
      };
      if (isEligibleCandidate(candidate, ctx)) out.push(candidate);
    }

    if (out.length >= target || data.length < CANDIDATE_PAGE) break;
  }

  return out;
}

/**
 * Tops up one user's board for `today` and returns what actually landed.
 *
 * Safe to call repeatedly: the planner computes a zero deficit once the board
 * is full, and the writes are guarded by unique(user_id, company_id) and a
 * compare-and-swap on the revive, so even two concurrent runs can't duplicate.
 */
export async function generateDailyList(
  userId: string,
  today: string = todayInCopenhagen(),
): Promise<DailyListSummary> {
  const supabase = createSupabaseServiceClient();

  const [prefs, existing] = await Promise.all([
    readPreferences(supabase, userId),
    readAllAssignments(supabase, userId),
  ]);
  const exclusions = await readExclusions(supabase, userId);

  // Cheap pre-compute so a full board skips the candidate scan entirely.
  const unworked = existing.filter(
    (a) => a.status === "new" && !a.inTrash,
  ).length;
  const deficit = Math.max(0, prefs.dailyTarget - unworked);

  const candidates = await readCandidates(
    supabase,
    userId,
    deficit,
    existing,
    exclusions,
  );

  const plan = planDailyList({
    today,
    prefs,
    existing,
    candidates,
    exclusions,
  });

  let fresh = 0;
  if (plan.inserts.length > 0) {
    const { data, error } = await supabase
      .from("lead_assignments")
      .upsert(
        plan.inserts.map((row) => ({ ...row, user_id: userId })),
        { onConflict: "user_id,company_id", ignoreDuplicates: true },
      )
      .select("id");
    if (error) throw error;
    fresh = data?.length ?? 0;
  }

  const revivedCounts = { recycled: 0, fill: 0 };
  for (const origin of ["recycled", "fill"] as const) {
    const ids = plan.revives
      .filter((r) => r.origin === origin)
      .map((r) => r.id);
    if (ids.length === 0) continue;

    const { data, error } = await supabase
      .from("lead_assignments")
      .update({
        in_trash: false,
        status: "new",
        origin,
        list_date: today,
        // Clear the stale date. Leaving a past follow-up on an active lead
        // would let it re-qualify for recycling the moment it's trashed again.
        follow_up_at: null,
      })
      .in("id", ids)
      .eq("user_id", userId)
      .is("deleted_at", null)
      // Compare-and-swap: a concurrent run that already revived these rows
      // won't match, so neither run double-counts.
      .eq("in_trash", true)
      .select("id");
    if (error) throw error;
    revivedCounts[origin] = data?.length ?? 0;
  }

  // Report what landed, not what was planned — a concurrent run may have taken
  // some of it.
  return {
    fresh,
    recycled: revivedCounts.recycled,
    fill: revivedCounts.fill,
    total: fresh + revivedCounts.recycled + revivedCounts.fill,
    unworkedBefore: plan.summary.unworkedBefore,
    deficit: plan.summary.deficit,
  };
}
