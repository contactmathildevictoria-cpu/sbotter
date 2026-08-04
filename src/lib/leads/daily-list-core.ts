/**
 * The daily lead-list planner.
 *
 * PURE. No I/O, no clock, no Supabase, no `next/*`, no `server-only`.
 * Everything it needs is passed in — including today's date — so the whole of
 * the priority logic is testable without a database. `daily-list.ts` is the
 * thin wrapper that reads the inputs and writes the output.
 *
 * The planner applies the eligibility filters itself rather than trusting the
 * caller to have pre-filtered. The wrapper does narrow the pool while paging,
 * but "an excluded company can never reach the board" is a property of this
 * file, which is where it can actually be tested.
 *
 * See daily-list-core.test.ts for the behaviour this file is pinned to.
 */

import type { LeadStatus } from "@/types/database";

export type ListPreferences = {
  /** T — how many UNWORKED leads the user's board is topped up to. */
  dailyTarget: number;
  /** M — global per-run budget for trash-sourced leads (recycled + fill). */
  trashMax: number;
  /** Days a "no pickup" lead rests before it resurfaces. Carried for callers. */
  followUpDays: number;
};

/** The projection of a `lead_assignments` row the planner needs. */
export type ExistingAssignment = {
  id: string;
  companyId: string;
  status: LeadStatus;
  inTrash: boolean;
  /** 'YYYY-MM-DD' or null. */
  followUpAt: string | null;
  /** 'YYYY-MM-DD'. */
  listDate: string;
  /**
   * ISO timestamp, or null when live. A deleted row is gone from the user's
   * board but MUST stay in `existing`: it is what keeps the company out of the
   * fresh pool forever. See isDeleted below.
   */
  deletedAt: string | null;
};

/**
 * A lead the user removed from their list.
 *
 * Deleted rows are treated asymmetrically on purpose:
 *   * they DO count towards `assignedCompanyIds`, so the company is never
 *     handed to this user again — the whole point of deleting it;
 *   * they DON'T count as unworked, or the deletions would suppress the daily
 *     top-up and the board would slowly starve;
 *   * they are NEVER picked as recycled or fill, or a deleted lead would come
 *     straight back out of the trash.
 */
function isDeleted(a: ExistingAssignment): boolean {
  return a.deletedAt !== null;
}

/** The projection of a candidate `companies` row the planner needs. */
export type CandidateCompany = {
  id: string;
  /** Equals slugify(name) — see companies.slug. */
  slug: string;
  cvr: string | null;
  domain: string | null;
  cvrIndustryCode: number | null;
  isBankrupt: boolean;
  openJobsCount: number;
  /** ISO timestamptz. */
  lastSeenAt: string;
};

export type Exclusions = {
  /** Already slugified, i.e. directly comparable to CandidateCompany.slug. */
  nameNormalized: string[];
  cvrs: string[];
  domains: string[];
  industryCodes: number[];
};

export const NO_EXCLUSIONS: Exclusions = {
  nameNormalized: [],
  cvrs: [],
  domains: [],
  industryCodes: [],
};

export type EligibilityContext = {
  assignedCompanyIds: ReadonlySet<string>;
  excludedNames: readonly string[];
  excludedCvrs: ReadonlySet<string>;
  excludedDomains: ReadonlySet<string>;
  blockedIndustryCodes: ReadonlySet<number>;
};

export type DailyListInput = {
  /** 'YYYY-MM-DD'. Injected — the planner never reads a clock. */
  today: string;
  prefs: ListPreferences;
  /** ALL of the user's assignment rows. Must be complete, or the top-up misfires. */
  existing: readonly ExistingAssignment[];
  /** Pool of companies to draw from, in any order. Re-filtered here. */
  candidates: readonly CandidateCompany[];
  exclusions: Exclusions;
};

export type PlannedInsert = {
  company_id: string;
  list_date: string;
  origin: "fresh";
};

export type PlannedRevive = {
  id: string;
  list_date: string;
  origin: "recycled" | "fill";
};

export type DailyListSummary = {
  fresh: number;
  recycled: number;
  fill: number;
  total: number;
  unworkedBefore: number;
  deficit: number;
};

export type DailyListPlan = {
  inserts: PlannedInsert[];
  revives: PlannedRevive[];
  summary: DailyListSummary;
};

/**
 * A lead is "unworked" while it sits untouched in the New column. Anything the
 * user has acted on — contacted, no pickup, meeting, won, lost — no longer
 * counts against the daily target.
 */
function isUnworked(a: ExistingAssignment): boolean {
  return a.status === "new" && !a.inTrash && !isDeleted(a);
}

export function buildEligibilityContext(
  existing: readonly ExistingAssignment[],
  exclusions: Exclusions,
): EligibilityContext {
  return {
    // Covers active, trashed AND deleted assignments: a company the user has
    // already been given must never come back around as "fresh". Deleting a
    // lead relies on this — the row stays so the pair stays taken.
    assignedCompanyIds: new Set(existing.map((a) => a.companyId)),
    excludedNames: exclusions.nameNormalized.filter((n) => n.length > 0),
    excludedCvrs: new Set(exclusions.cvrs),
    excludedDomains: new Set(exclusions.domains),
    blockedIndustryCodes: new Set(exclusions.industryCodes),
  };
}

export function isEligibleCandidate(
  company: CandidateCompany,
  ctx: EligibilityContext,
): boolean {
  // Cheapest checks first.
  if (ctx.assignedCompanyIds.has(company.id)) return false;
  if (company.isBankrupt) return false;
  if (company.openJobsCount < 1) return false;

  // A company with no industry code is never blocked — we can't prove it is in
  // a blocked industry, and most of the pool has no code yet.
  if (
    company.cvrIndustryCode !== null &&
    ctx.blockedIndustryCodes.has(company.cvrIndustryCode)
  ) {
    return false;
  }

  if (company.cvr !== null && ctx.excludedCvrs.has(company.cvr)) return false;
  if (company.domain !== null && ctx.excludedDomains.has(company.domain)) {
    return false;
  }

  // Name match against companies.slug. The trailing "-" is load-bearing:
  // "arla" must exclude "arla-foods" but NOT "arlandia".
  for (const name of ctx.excludedNames) {
    if (company.slug === name || company.slug.startsWith(`${name}-`)) {
      return false;
    }
  }

  return true;
}

/** Ascending, nulls last. A null follow-up means "never scheduled". */
function byFollowUpAsc(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a < b ? -1 : 1;
}

function byIdAsc(a: { id: string }, b: { id: string }): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function planDailyList(input: DailyListInput): DailyListPlan {
  const { today, prefs, existing, candidates, exclusions } = input;

  const unworkedBefore = existing.filter(isUnworked).length;

  // TOP-UP SEMANTICS. This deviates from docs/fase-1-liste-motor-og-crm.md §2,
  // which literally says "take T fresh per day". We instead top up so the user
  // HAS daily_target unworked leads. Someone who worked 5 of yesterday's 50
  // does not want 95 on their desk today.
  //
  // Side effect worth knowing: this makes the engine idempotent for free.
  // After a successful run unworkedBefore === T, so a second run the same day
  // computes deficit === 0 and plans nothing. The doc's §2.5 list_date
  // bookkeeping is therefore unnecessary.
  const deficit = Math.max(0, prefs.dailyTarget - unworkedBefore);

  if (deficit === 0) {
    return {
      inserts: [],
      revives: [],
      summary: {
        fresh: 0,
        recycled: 0,
        fill: 0,
        total: 0,
        unworkedBefore,
        deficit,
      },
    };
  }

  // trash_max is a GLOBAL budget for this run, spanning both recycled and
  // fill. The doc caps only the recycled tier, which would let a thin scrape
  // day drain the whole trash onto the board and make the setting meaningless.
  const trashBudget = Math.max(0, prefs.trashMax);

  // ---- 1. Recycled: follow-ups that have come due, oldest first. ----------
  const recycled = existing
    .filter(
      (a) =>
        a.inTrash && !isDeleted(a) && a.followUpAt !== null && a.followUpAt <= today,
    )
    .sort((a, b) => byFollowUpAsc(a.followUpAt, b.followUpAt) || byIdAsc(a, b))
    .slice(0, Math.min(trashBudget, deficit));

  const recycledIds = new Set(recycled.map((a) => a.id));

  // ---- 2. Fresh: eligible companies, most recently seen first. ------------
  const ctx = buildEligibilityContext(existing, exclusions);
  const seen = new Set<string>();
  const fresh = candidates
    .filter((c) => {
      if (seen.has(c.id)) return false; // the pool may be paged with overlap
      seen.add(c.id);
      return isEligibleCandidate(c, ctx);
    })
    .sort(
      (a, b) =>
        // lastSeenAt descending, id ascending as a stable tiebreak.
        (a.lastSeenAt < b.lastSeenAt
          ? 1
          : a.lastSeenAt > b.lastSeenAt
            ? -1
            : 0) || byIdAsc(a, b),
    )
    .slice(0, deficit - recycled.length);

  // ---- 3. Fill: anything still in the trash, ignoring follow_up_at. -------
  // Only reached when the scrape was thin. Shares the same trash budget.
  const fillBudget = Math.min(
    deficit - recycled.length - fresh.length,
    trashBudget - recycled.length,
  );
  const fill =
    fillBudget > 0
      ? existing
          .filter((a) => a.inTrash && !isDeleted(a) && !recycledIds.has(a.id))
          .sort(
            (a, b) =>
              byFollowUpAsc(a.followUpAt, b.followUpAt) ||
              (a.listDate < b.listDate
                ? -1
                : a.listDate > b.listDate
                  ? 1
                  : 0) ||
              byIdAsc(a, b),
          )
          .slice(0, fillBudget)
      : [];

  return {
    inserts: fresh.map((c) => ({
      company_id: c.id,
      list_date: today,
      origin: "fresh" as const,
    })),
    revives: [
      ...recycled.map((a) => ({
        id: a.id,
        list_date: today,
        origin: "recycled" as const,
      })),
      ...fill.map((a) => ({
        id: a.id,
        list_date: today,
        origin: "fill" as const,
      })),
    ],
    summary: {
      fresh: fresh.length,
      recycled: recycled.length,
      fill: fill.length,
      total: fresh.length + recycled.length + fill.length,
      unworkedBefore,
      deficit,
    },
  };
}

// ============================================================
// Date helpers
// ============================================================
// All list dates are computed in Europe/Copenhagen, in TS. Postgres runs UTC
// on Supabase, so `current_date` and `current_date + n` would drift by a day
// for anything happening in the Danish evening.

/** Today's date as 'YYYY-MM-DD' in Europe/Copenhagen. */
export function todayInCopenhagen(now: Date = new Date()): string {
  // en-CA formats as YYYY-MM-DD, which is exactly what Postgres `date` wants.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Copenhagen",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/**
 * Adds whole days to a 'YYYY-MM-DD' string.
 *
 * Uses UTC arithmetic on a date-only value on purpose. Doing this with a local
 * `Date` and `setDate()` drifts by an hour across the CET↔CEST boundary, which
 * is enough to land follow-ups on the wrong day twice a year.
 */
export function addDaysISO(dateISO: string, days: number): string {
  const [y, m, d] = dateISO.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d) + days * 86_400_000)
    .toISOString()
    .slice(0, 10);
}
