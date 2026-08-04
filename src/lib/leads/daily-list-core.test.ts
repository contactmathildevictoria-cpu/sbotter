import { describe, expect, it } from "vitest";
import {
  addDaysISO,
  buildEligibilityContext,
  isEligibleCandidate,
  NO_EXCLUSIONS,
  planDailyList,
  todayInCopenhagen,
  type CandidateCompany,
  type DailyListInput,
  type DailyListPlan,
  type ExistingAssignment,
  type Exclusions,
  type ListPreferences,
} from "@/lib/leads/daily-list-core";

const TODAY = "2026-07-28";

const PREFS: ListPreferences = {
  dailyTarget: 50,
  trashMax: 10,
  followUpDays: 7,
};

function makeCandidate(over: Partial<CandidateCompany> = {}): CandidateCompany {
  return {
    id: "c-1",
    slug: "eksempel-aps",
    cvr: null,
    domain: null,
    cvrIndustryCode: null,
    isBankrupt: false,
    openJobsCount: 3,
    lastSeenAt: "2026-07-28T09:00:00.000Z",
    ...over,
  };
}

/** n candidates, newest first by construction (c-000 is the most recent). */
function makeCandidates(n: number): CandidateCompany[] {
  return Array.from({ length: n }, (_, i) =>
    makeCandidate({
      id: `c-${String(i).padStart(3, "0")}`,
      slug: `firma-${i}`,
      // Descending timestamps so index order == priority order.
      lastSeenAt: new Date(Date.UTC(2026, 6, 28, 12) - i * 60_000).toISOString(),
    }),
  );
}

function makeAssignment(
  over: Partial<ExistingAssignment> = {},
): ExistingAssignment {
  return {
    id: "a-1",
    companyId: "assigned-1",
    status: "new",
    inTrash: false,
    followUpAt: null,
    listDate: TODAY,
    deletedAt: null,
    ...over,
  };
}

function makeInput(over: Partial<DailyListInput> = {}): DailyListInput {
  return {
    today: TODAY,
    prefs: PREFS,
    existing: [],
    candidates: [],
    exclusions: NO_EXCLUSIONS,
    ...over,
  };
}

function exclusions(over: Partial<Exclusions> = {}): Exclusions {
  return { ...NO_EXCLUSIONS, ...over };
}

/**
 * Applies a plan to an assignment list, the way the DB writes would. Lets the
 * idempotence tests re-plan against the post-run state.
 */
function applyPlan(
  existing: ExistingAssignment[],
  plan: DailyListPlan,
): ExistingAssignment[] {
  const revivedById = new Map(plan.revives.map((r) => [r.id, r]));
  const updated = existing.map((a) => {
    const revive = revivedById.get(a.id);
    if (!revive) return a;
    return {
      ...a,
      inTrash: false,
      status: "new" as const,
      listDate: revive.list_date,
      followUpAt: null,
    };
  });
  const inserted = plan.inserts.map((row, i) => ({
    id: `new-${row.company_id}-${i}`,
    companyId: row.company_id,
    status: "new" as const,
    inTrash: false,
    followUpAt: null,
    listDate: row.list_date,
    deletedAt: null,
  }));
  return [...updated, ...inserted];
}

// ============================================================
// Eligibility
// ============================================================
describe("isEligibleCandidate", () => {
  const ctxWith = (
    existing: ExistingAssignment[],
    excl: Exclusions = NO_EXCLUSIONS,
  ) => buildEligibilityContext(existing, excl);

  it("accepts a plain, unencumbered company", () => {
    expect(isEligibleCandidate(makeCandidate(), ctxWith([]))).toBe(true);
  });

  it("rejects a company already assigned and active", () => {
    const ctx = ctxWith([makeAssignment({ companyId: "c-1" })]);
    expect(isEligibleCandidate(makeCandidate({ id: "c-1" }), ctx)).toBe(false);
  });

  it("rejects a company already assigned but sitting in the trash", () => {
    // The whole point of unique(user_id, company_id): a trashed lead must not
    // reappear as a fresh one.
    const ctx = ctxWith([
      makeAssignment({
        companyId: "c-1",
        inTrash: true,
        status: "no_pickup",
        followUpAt: "2026-08-04",
      }),
    ]);
    expect(isEligibleCandidate(makeCandidate({ id: "c-1" }), ctx)).toBe(false);
  });

  it("rejects a bankrupt company", () => {
    expect(
      isEligibleCandidate(makeCandidate({ isBankrupt: true }), ctxWith([])),
    ).toBe(false);
  });

  it("rejects a company with no open jobs", () => {
    expect(
      isEligibleCandidate(makeCandidate({ openJobsCount: 0 }), ctxWith([])),
    ).toBe(false);
  });

  it("rejects an exact excluded-name match", () => {
    const ctx = ctxWith([], exclusions({ nameNormalized: ["arla"] }));
    expect(isEligibleCandidate(makeCandidate({ slug: "arla" }), ctx)).toBe(
      false,
    );
  });

  it("rejects a prefix match: 'arla' excludes 'arla-foods'", () => {
    const ctx = ctxWith([], exclusions({ nameNormalized: ["arla"] }));
    expect(isEligibleCandidate(makeCandidate({ slug: "arla-foods" }), ctx)).toBe(
      false,
    );
    expect(
      isEligibleCandidate(makeCandidate({ slug: "arla-foods-a-s" }), ctx),
    ).toBe(false);
  });

  it("does NOT reject a false prefix: 'arla' must not exclude 'arlandia'", () => {
    // This is why the match appends "-" instead of a bare startsWith.
    const ctx = ctxWith([], exclusions({ nameNormalized: ["arla"] }));
    expect(isEligibleCandidate(makeCandidate({ slug: "arlandia" }), ctx)).toBe(
      true,
    );
  });

  it("ignores an empty excluded name so it can't match everything", () => {
    const ctx = ctxWith([], exclusions({ nameNormalized: [""] }));
    expect(isEligibleCandidate(makeCandidate({ slug: "arla" }), ctx)).toBe(true);
  });

  it("rejects a blocked industry code", () => {
    const ctx = ctxWith([], exclusions({ industryCodes: [782000] }));
    expect(
      isEligibleCandidate(makeCandidate({ cvrIndustryCode: 782000 }), ctx),
    ).toBe(false);
  });

  it("lets a company with no industry code through even when codes are blocked", () => {
    // Most of the pool has no CVR industry code yet; blocking them all would
    // empty the list.
    const ctx = ctxWith([], exclusions({ industryCodes: [782000] }));
    expect(
      isEligibleCandidate(makeCandidate({ cvrIndustryCode: null }), ctx),
    ).toBe(true);
  });

  it("rejects on an excluded cvr or domain", () => {
    const byCvr = ctxWith([], exclusions({ cvrs: ["12345678"] }));
    expect(
      isEligibleCandidate(makeCandidate({ cvr: "12345678" }), byCvr),
    ).toBe(false);

    const byDomain = ctxWith([], exclusions({ domains: ["arla.dk"] }));
    expect(
      isEligibleCandidate(makeCandidate({ domain: "arla.dk" }), byDomain),
    ).toBe(false);
  });
});

// ============================================================
// Deleted leads
// ============================================================
// A deleted lead is handled asymmetrically, and each half matters:
//   * still "already assigned" → the company is never handed out again
//   * not unworked             → deletions don't suppress the daily top-up
//   * never recycled or fill   → it can't come back out of the trash
describe("deleted leads", () => {
  const deleted = (over: Partial<ExistingAssignment> = {}) =>
    makeAssignment({ deletedAt: "2026-07-28T10:00:00.000Z", ...over });

  it("keeps the company out of the fresh pool forever", () => {
    // The reason delete is a soft delete: the row is what holds the
    // (user_id, company_id) pair, so the engine can't re-offer it.
    const ctx = buildEligibilityContext(
      [deleted({ companyId: "c-1" })],
      NO_EXCLUSIONS,
    );
    expect(isEligibleCandidate(makeCandidate({ id: "c-1" }), ctx)).toBe(false);
  });

  it("never re-assigns a deleted company through a full plan", () => {
    const plan = planDailyList(
      makeInput({
        existing: [deleted({ companyId: "c-000" })],
        candidates: makeCandidates(200),
      }),
    );
    expect(plan.inserts.map((r) => r.company_id)).not.toContain("c-000");
    expect(plan.inserts).toHaveLength(50);
  });

  it("does not count as unworked, so it can't starve the top-up", () => {
    // 50 deleted leads must not read as a full board — otherwise deleting
    // everything would silently stop new leads arriving.
    const existing = Array.from({ length: 50 }, (_, i) =>
      deleted({ id: `d-${i}`, companyId: `del-${i}` }),
    );
    const plan = planDailyList(
      makeInput({ existing, candidates: makeCandidates(200) }),
    );
    expect(plan.summary.unworkedBefore).toBe(0);
    expect(plan.summary.deficit).toBe(50);
    expect(plan.summary.fresh).toBe(50);
  });

  it("counts live leads but not deleted ones", () => {
    const existing = [
      ...Array.from({ length: 20 }, (_, i) =>
        makeAssignment({ id: `live-${i}`, companyId: `l-${i}` }),
      ),
      ...Array.from({ length: 15 }, (_, i) =>
        deleted({ id: `gone-${i}`, companyId: `g-${i}` }),
      ),
    ];
    const plan = planDailyList(
      makeInput({ existing, candidates: makeCandidates(200) }),
    );
    expect(plan.summary.unworkedBefore).toBe(20);
    expect(plan.summary.deficit).toBe(30);
  });

  it("is never recycled, even when its follow-up is due", () => {
    // A lead deleted while sitting in the trash with a due follow-up is the
    // exact case that would resurrect it.
    const existing = [
      deleted({
        id: "t-1",
        companyId: "tc-1",
        inTrash: true,
        status: "no_pickup",
        followUpAt: "2026-07-01",
      }),
    ];
    const plan = planDailyList(
      makeInput({ existing, candidates: makeCandidates(5) }),
    );
    expect(plan.summary.recycled).toBe(0);
    expect(plan.revives).toHaveLength(0);
  });

  it("is never used as fill on a thin scrape day", () => {
    // With an empty candidate pool, fill would otherwise reach for any trashed
    // row it can find — including deleted ones.
    const existing = Array.from({ length: 20 }, (_, i) =>
      deleted({
        id: `t-${i}`,
        companyId: `tc-${i}`,
        inTrash: true,
        status: "no_pickup",
        followUpAt: null,
      }),
    );
    const plan = planDailyList(
      makeInput({ existing, candidates: makeCandidates(0) }),
    );
    expect(plan.summary.fill).toBe(0);
    expect(plan.summary.total).toBe(0);
  });

  it("still recycles live trashed leads alongside deleted ones", () => {
    // The exclusion must be precise: deleting one lead can't stop another
    // from coming back.
    const existing = [
      deleted({
        id: "gone",
        companyId: "g-1",
        inTrash: true,
        followUpAt: "2026-07-01",
      }),
      makeAssignment({
        id: "live",
        companyId: "l-1",
        inTrash: true,
        status: "no_pickup",
        followUpAt: "2026-07-01",
      }),
    ];
    const plan = planDailyList(
      makeInput({ existing, candidates: makeCandidates(0) }),
    );
    expect(plan.summary.recycled).toBe(1);
    expect(plan.revives.map((r) => r.id)).toEqual(["live"]);
  });
});

// ============================================================
// Top-up semantics
// ============================================================
describe("planDailyList — top-up", () => {
  it("fills an empty board to the daily target", () => {
    const plan = planDailyList(makeInput({ candidates: makeCandidates(200) }));
    expect(plan.summary).toMatchObject({
      fresh: 50,
      recycled: 0,
      fill: 0,
      total: 50,
      unworkedBefore: 0,
      deficit: 50,
    });
    expect(plan.inserts).toHaveLength(50);
    expect(plan.revives).toHaveLength(0);
  });

  it("only tops up the shortfall when unworked leads are left over", () => {
    const existing = Array.from({ length: 30 }, (_, i) =>
      makeAssignment({ id: `a-${i}`, companyId: `old-${i}` }),
    );
    const plan = planDailyList(
      makeInput({ existing, candidates: makeCandidates(200) }),
    );
    expect(plan.summary.unworkedBefore).toBe(30);
    expect(plan.summary.deficit).toBe(20);
    expect(plan.inserts).toHaveLength(20);
  });

  it("plans nothing when the board is already full", () => {
    const existing = Array.from({ length: 50 }, (_, i) =>
      makeAssignment({ id: `a-${i}`, companyId: `old-${i}` }),
    );
    const plan = planDailyList(
      makeInput({ existing, candidates: makeCandidates(200) }),
    );
    expect(plan.summary.deficit).toBe(0);
    expect(plan.summary.total).toBe(0);
    expect(plan.inserts).toHaveLength(0);
    expect(plan.revives).toHaveLength(0);
  });

  it("never removes leads when the target is lowered below the current count", () => {
    const existing = Array.from({ length: 60 }, (_, i) =>
      makeAssignment({ id: `a-${i}`, companyId: `old-${i}` }),
    );
    const plan = planDailyList(
      makeInput({ existing, candidates: makeCandidates(200) }),
    );
    expect(plan.summary.deficit).toBe(0);
    expect(plan.summary.total).toBe(0);
  });

  it("counts only status='new' && !in_trash as unworked", () => {
    const existing = [
      ...Array.from({ length: 20 }, (_, i) =>
        makeAssignment({ id: `new-${i}`, companyId: `n-${i}` }),
      ),
      ...Array.from({ length: 30 }, (_, i) =>
        makeAssignment({
          id: `done-${i}`,
          companyId: `d-${i}`,
          status: "contacted",
        }),
      ),
      // Trashed rows with status 'new' must not count either.
      ...Array.from({ length: 5 }, (_, i) =>
        makeAssignment({
          id: `trash-${i}`,
          companyId: `t-${i}`,
          inTrash: true,
          followUpAt: "2026-09-01",
        }),
      ),
    ];
    const plan = planDailyList(
      makeInput({ existing, candidates: makeCandidates(200) }),
    );
    expect(plan.summary.unworkedBefore).toBe(20);
    expect(plan.summary.deficit).toBe(30);
  });
});

// ============================================================
// Priority order
// ============================================================
describe("planDailyList — priority", () => {
  const dueTrash = (n: number, fromDate = "2026-07-01") =>
    Array.from({ length: n }, (_, i) =>
      makeAssignment({
        id: `trash-${String(i).padStart(2, "0")}`,
        companyId: `tc-${i}`,
        inTrash: true,
        status: "no_pickup",
        followUpAt: addDaysISO(fromDate, i),
      }),
    );

  it("spends the budget on due follow-ups before fresh leads", () => {
    const plan = planDailyList(
      makeInput({ existing: dueTrash(5), candidates: makeCandidates(200) }),
    );
    expect(plan.summary).toMatchObject({ recycled: 5, fresh: 45, total: 50 });
  });

  it("caps recycled at trash_max", () => {
    const plan = planDailyList(
      makeInput({
        prefs: { ...PREFS, trashMax: 3 },
        existing: dueTrash(10),
        candidates: makeCandidates(200),
      }),
    );
    expect(plan.summary.recycled).toBe(3);
    expect(plan.summary.fresh).toBe(47);
  });

  it("recycles the oldest follow-up first", () => {
    const plan = planDailyList(
      makeInput({
        prefs: { ...PREFS, trashMax: 2 },
        existing: dueTrash(10),
        candidates: makeCandidates(200),
      }),
    );
    // dueTrash assigns ascending follow-up dates from 2026-07-01.
    expect(plan.revives.map((r) => r.id)).toEqual(["trash-00", "trash-01"]);
  });

  it("does not recycle a follow-up that is not due yet", () => {
    const notDue = [
      makeAssignment({
        id: "future",
        companyId: "f-1",
        inTrash: true,
        status: "no_pickup",
        followUpAt: "2026-08-15",
      }),
    ];
    const plan = planDailyList(
      makeInput({ existing: notDue, candidates: makeCandidates(200) }),
    );
    expect(plan.summary.recycled).toBe(0);
    expect(plan.summary.fill).toBe(0); // pool was plentiful
    expect(plan.summary.fresh).toBe(50);
  });

  it("recycles a follow-up that is due exactly today", () => {
    const dueToday = [
      makeAssignment({
        id: "today",
        companyId: "f-1",
        inTrash: true,
        status: "no_pickup",
        followUpAt: TODAY,
      }),
    ];
    const plan = planDailyList(
      makeInput({ existing: dueToday, candidates: makeCandidates(200) }),
    );
    expect(plan.summary.recycled).toBe(1);
  });

  it("falls back to fill on a thin scrape, capped by the GLOBAL trash budget", () => {
    // 10 fresh available, 20 sitting in the trash with no due follow-up,
    // target 50, trash_max 10 => 10 fresh + 10 fill (not 40 fill).
    const trash = Array.from({ length: 20 }, (_, i) =>
      makeAssignment({
        id: `t-${String(i).padStart(2, "0")}`,
        companyId: `tc-${i}`,
        inTrash: true,
        status: "no_pickup",
        followUpAt: "2026-09-01", // all in the future
      }),
    );
    const plan = planDailyList(
      makeInput({ existing: trash, candidates: makeCandidates(10) }),
    );
    expect(plan.summary).toMatchObject({ fresh: 10, recycled: 0, fill: 10 });
    expect(plan.summary.total).toBe(20); // short of target — honest signal
  });

  it("shares one trash budget across recycled and fill", () => {
    const existing = [
      ...dueTrash(4), // due now
      ...Array.from({ length: 20 }, (_, i) =>
        makeAssignment({
          id: `future-${i}`,
          companyId: `fc-${i}`,
          inTrash: true,
          status: "no_pickup",
          followUpAt: "2026-09-01",
        }),
      ),
    ];
    const plan = planDailyList(
      makeInput({
        prefs: { ...PREFS, trashMax: 10 },
        existing,
        candidates: makeCandidates(5),
      }),
    );
    expect(plan.summary.recycled).toBe(4);
    expect(plan.summary.fresh).toBe(5);
    // 10 - 4 already recycled = 6 left in the budget.
    expect(plan.summary.fill).toBe(6);
  });

  it("takes nothing from the trash when trash_max is 0", () => {
    const plan = planDailyList(
      makeInput({
        prefs: { ...PREFS, trashMax: 0 },
        existing: dueTrash(10),
        candidates: makeCandidates(5),
      }),
    );
    expect(plan.summary.recycled).toBe(0);
    expect(plan.summary.fill).toBe(0);
    expect(plan.summary.fresh).toBe(5);
  });

  it("never picks the same row as both recycled and fill", () => {
    const plan = planDailyList(
      makeInput({ existing: dueTrash(8), candidates: makeCandidates(0) }),
    );
    const ids = plan.revives.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("fills from trashed rows regardless of follow_up_at, including null", () => {
    const existing = [
      makeAssignment({
        id: "no-date",
        companyId: "nd-1",
        inTrash: true,
        status: "lost",
        followUpAt: null,
      }),
    ];
    const plan = planDailyList(
      makeInput({ existing, candidates: makeCandidates(0) }),
    );
    expect(plan.summary.fill).toBe(1);
    expect(plan.revives[0]).toMatchObject({ id: "no-date", origin: "fill" });
  });

  it("keeps excluded companies out of the fresh tier entirely", () => {
    const candidates = [
      makeCandidate({ id: "keep", slug: "gode-kunder", lastSeenAt: "2026-07-28T12:00:00.000Z" }),
      makeCandidate({ id: "byname", slug: "arla-foods", lastSeenAt: "2026-07-28T11:00:00.000Z" }),
      makeCandidate({ id: "bycode", cvrIndustryCode: 782000, slug: "vikar-aps", lastSeenAt: "2026-07-28T10:00:00.000Z" }),
      makeCandidate({ id: "bankrupt", isBankrupt: true, slug: "konkurs-aps", lastSeenAt: "2026-07-28T09:00:00.000Z" }),
      makeCandidate({ id: "bycvr", cvr: "12345678", slug: "cvr-aps", lastSeenAt: "2026-07-28T08:00:00.000Z" }),
    ];
    const plan = planDailyList(
      makeInput({
        candidates,
        exclusions: exclusions({
          nameNormalized: ["arla"],
          industryCodes: [782000],
          cvrs: ["12345678"],
        }),
      }),
    );
    expect(plan.inserts.map((r) => r.company_id)).toEqual(["keep"]);
  });

  it("orders fresh leads by last_seen_at, newest first", () => {
    const candidates = [
      makeCandidate({ id: "old", slug: "a", lastSeenAt: "2026-07-01T00:00:00.000Z" }),
      makeCandidate({ id: "newest", slug: "b", lastSeenAt: "2026-07-28T00:00:00.000Z" }),
      makeCandidate({ id: "middle", slug: "c", lastSeenAt: "2026-07-14T00:00:00.000Z" }),
    ];
    const plan = planDailyList(
      makeInput({ prefs: { ...PREFS, dailyTarget: 2 }, candidates }),
    );
    expect(plan.inserts.map((r) => r.company_id)).toEqual(["newest", "middle"]);
  });
});

// ============================================================
// Idempotence and determinism
// ============================================================
describe("planDailyList — idempotence", () => {
  it("plans nothing on a second run the same day", () => {
    const input = makeInput({ candidates: makeCandidates(200) });
    const first = planDailyList(input);
    expect(first.summary.total).toBe(50);

    const after = applyPlan([], first);
    const second = planDailyList({ ...input, existing: after });
    expect(second.summary.total).toBe(0);
    expect(second.inserts).toHaveLength(0);
    expect(second.revives).toHaveLength(0);
  });

  it("does not re-hand-out a company inserted on a previous run", () => {
    const input = makeInput({ candidates: makeCandidates(60) });
    const first = planDailyList(input);
    const after = applyPlan([], first);

    // Simulate the user working all of them, so a top-up is due again.
    const worked = after.map((a) => ({ ...a, status: "contacted" as const }));
    const second = planDailyList({ ...input, existing: worked });

    const firstIds = new Set(first.inserts.map((r) => r.company_id));
    for (const row of second.inserts) {
      expect(firstIds.has(row.company_id)).toBe(false);
    }
    expect(second.summary.fresh).toBe(10); // only 10 of the 60 were left
  });

  it("is deterministic across identical calls", () => {
    const input = makeInput({
      existing: [
        makeAssignment({
          id: "t-1",
          companyId: "tc-1",
          inTrash: true,
          followUpAt: "2026-07-01",
        }),
      ],
      candidates: makeCandidates(120),
    });
    expect(planDailyList(input)).toEqual(planDailyList(input));
  });

  it("emits no duplicate company_id and no id in both revive tiers", () => {
    const existing = Array.from({ length: 30 }, (_, i) =>
      makeAssignment({
        id: `t-${i}`,
        companyId: `tc-${i}`,
        inTrash: true,
        followUpAt: i < 5 ? "2026-07-01" : null,
      }),
    );
    // Duplicate the candidate pool to mimic overlapping pages.
    const pool = makeCandidates(20);
    const plan = planDailyList(
      makeInput({ existing, candidates: [...pool, ...pool] }),
    );

    const companyIds = plan.inserts.map((r) => r.company_id);
    expect(new Set(companyIds).size).toBe(companyIds.length);

    const reviveIds = plan.revives.map((r) => r.id);
    expect(new Set(reviveIds).size).toBe(reviveIds.length);
  });

  it("never plans more than the deficit, nor more than the daily target", () => {
    const existing = Array.from({ length: 40 }, (_, i) =>
      makeAssignment({
        id: `t-${i}`,
        companyId: `tc-${i}`,
        inTrash: true,
        followUpAt: "2026-07-01",
      }),
    );
    const plan = planDailyList(
      makeInput({ existing, candidates: makeCandidates(500) }),
    );
    expect(plan.summary.total).toBeLessThanOrEqual(plan.summary.deficit);
    expect(plan.summary.total).toBeLessThanOrEqual(PREFS.dailyTarget);
  });

  it("stamps every planned row with today's date", () => {
    const existing = [
      makeAssignment({
        id: "t-1",
        companyId: "tc-1",
        inTrash: true,
        followUpAt: "2026-07-01",
        listDate: "2026-07-01",
      }),
    ];
    const plan = planDailyList(
      makeInput({ existing, candidates: makeCandidates(5) }),
    );
    for (const row of [...plan.inserts, ...plan.revives]) {
      expect(row.list_date).toBe(TODAY);
    }
  });
});

// ============================================================
// Dates
// ============================================================
describe("date helpers", () => {
  it("rolls over the year", () => {
    expect(addDaysISO("2026-12-28", 7)).toBe("2027-01-04");
  });

  it("handles a leap day", () => {
    expect(addDaysISO("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDaysISO("2027-02-28", 1)).toBe("2027-03-01");
  });

  it("does not drift across the CET->CEST boundary", () => {
    // DST starts in Denmark on 2026-03-29. A local-Date setDate()
    // implementation loses an hour here and can land on the wrong day.
    expect(addDaysISO("2026-03-28", 1)).toBe("2026-03-29");
    expect(addDaysISO("2026-03-28", 2)).toBe("2026-03-30");
    // And the CEST->CET boundary on 2026-10-25.
    expect(addDaysISO("2026-10-24", 1)).toBe("2026-10-25");
    expect(addDaysISO("2026-10-24", 2)).toBe("2026-10-26");
  });

  it("adds a follow-up window without surprises", () => {
    expect(addDaysISO("2026-07-28", 7)).toBe("2026-08-04");
    expect(addDaysISO("2026-07-28", 0)).toBe("2026-07-28");
  });

  it("reads today in Copenhagen, not UTC", () => {
    // 23:30 UTC on the 27th is already 01:30 on the 28th in CEST.
    expect(todayInCopenhagen(new Date("2026-07-27T23:30:00Z"))).toBe(
      "2026-07-28",
    );
    // And 21:00 UTC in winter (CET, +1) is still the same day.
    expect(todayInCopenhagen(new Date("2026-01-15T21:00:00Z"))).toBe(
      "2026-01-15",
    );
  });
});
