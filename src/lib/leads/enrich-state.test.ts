import { describe, expect, it } from "vitest";
import {
  QUEUED_TIMEOUT_MS,
  companyEnrichmentPasses,
  hasRunningPass,
  isCompanyEnriching,
  isPassRunning,
} from "@/lib/leads/enrich-state";

const NOW = Date.parse("2026-08-04T12:00:00.000Z");
const minutesAgo = (n: number) => new Date(NOW - n * 60_000).toISOString();

describe("isPassRunning", () => {
  it("spins for a queue that started just now", () => {
    expect(isPassRunning({ status: "queued", since: minutesAgo(1) }, NOW)).toBe(
      true,
    );
  });

  it("spins right up to the 30-minute cutoff", () => {
    const since = new Date(NOW - QUEUED_TIMEOUT_MS + 1000).toISOString();
    expect(isPassRunning({ status: "queued", since }, NOW)).toBe(true);
  });

  it("gives up on a queue older than 30 minutes", () => {
    // The rule this module exists for: whatever was supposed to write the
    // result back can die, and the status then never leaves 'queued'.
    expect(isPassRunning({ status: "queued", since: minutesAgo(31) }, NOW)).toBe(
      false,
    );
  });

  it("treats the cutoff itself as expired", () => {
    const since = new Date(NOW - QUEUED_TIMEOUT_MS).toISOString();
    expect(isPassRunning({ status: "queued", since }, NOW)).toBe(false);
  });

  it("treats a queue with no timestamp as expired", () => {
    // No proof the queue is fresh means no spinner — spinning forever is
    // exactly the failure being prevented.
    expect(isPassRunning({ status: "queued", since: null }, NOW)).toBe(false);
    expect(isPassRunning({ status: "queued", since: "not a date" }, NOW)).toBe(
      false,
    );
  });

  it("never spins for a status that is not a queue", () => {
    for (const status of [
      "pending",
      "enriched",
      "failed",
      "no_match",
      "skipped",
      "scraped",
      "no_website",
    ]) {
      expect(isPassRunning({ status, since: minutesAgo(1) }, NOW)).toBe(false);
    }
  });

  it("does not spin for 'pending', the state most rows sit in forever", () => {
    // The regression that made "Henter data…" show on every empty row.
    expect(isPassRunning({ status: "pending", since: null }, NOW)).toBe(false);
  });
});

describe("hasRunningPass", () => {
  it("is false when nothing is in flight", () => {
    expect(
      hasRunningPass(
        [
          { status: "pending", since: minutesAgo(1) },
          { status: "enriched", since: minutesAgo(1) },
        ],
        NOW,
      ),
    ).toBe(false);
  });

  it("is true when any single pass is in flight", () => {
    expect(
      hasRunningPass(
        [
          { status: "enriched", since: minutesAgo(1) },
          { status: "queued", since: minutesAgo(2) },
        ],
        NOW,
      ),
    ).toBe(true);
  });

  it("is false when every queue has gone stale", () => {
    expect(
      hasRunningPass(
        [
          { status: "queued", since: minutesAgo(45) },
          { status: "queued", since: minutesAgo(90) },
        ],
        NOW,
      ),
    ).toBe(false);
  });

  it("is false for a company with no passes at all", () => {
    expect(hasRunningPass([], NOW)).toBe(false);
  });
});

describe("companyEnrichmentPasses", () => {
  const row = {
    cvr_enrichment_status: "pending",
    website_scrape_status: "pending",
    ai_enrichment_status: "pending",
    updated_at: minutesAgo(5),
  };

  it("covers every enrichment source on the row, not just one", () => {
    const passes = companyEnrichmentPasses(row);
    expect(passes).toHaveLength(3);
    expect(passes.map((p) => p.since)).toEqual([
      row.updated_at,
      row.updated_at,
      row.updated_at,
    ]);
  });

  it("applies the queue rule to whichever source is queued", () => {
    for (const key of [
      "cvr_enrichment_status",
      "website_scrape_status",
      "ai_enrichment_status",
    ] as const) {
      const fresh = { ...row, [key]: "queued" };
      expect(hasRunningPass(companyEnrichmentPasses(fresh), NOW)).toBe(true);

      const stale = { ...fresh, updated_at: minutesAgo(31) };
      expect(hasRunningPass(companyEnrichmentPasses(stale), NOW)).toBe(false);
    }
  });

  it("shows no spinner for a row that has never been touched", () => {
    expect(
      hasRunningPass(companyEnrichmentPasses({ ...row, updated_at: null }), NOW),
    ).toBe(false);
  });
});

describe("isCompanyEnriching — the wall-clock entry point", () => {
  const base = {
    cvr_enrichment_status: "pending",
    website_scrape_status: "pending",
    ai_enrichment_status: "pending",
  };

  it("is false when no pass is queued", () => {
    expect(
      isCompanyEnriching({ ...base, updated_at: new Date().toISOString() }),
    ).toBe(false);
  });

  it("is true for a queue that started a moment ago", () => {
    expect(
      isCompanyEnriching({
        ...base,
        cvr_enrichment_status: "queued",
        updated_at: new Date().toISOString(),
      }),
    ).toBe(true);
  });

  it("is false for a queue stuck since yesterday", () => {
    expect(
      isCompanyEnriching({
        ...base,
        cvr_enrichment_status: "queued",
        updated_at: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
      }),
    ).toBe(false);
  });
});
