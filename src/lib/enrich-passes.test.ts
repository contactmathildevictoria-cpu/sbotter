import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Structural checks that the fast passes and the AI pass stay independent.
 *
 * cvr.ts is `server-only` and every pass talks to Supabase and the network, so
 * it can't be imported here. What can break silently, though, is the wiring:
 * someone re-adds the AI pass to the interactive batch and the "Enrich all"
 * button starts hanging again. These read the source to pin that wiring.
 */

const root = join(import.meta.dirname, "..", "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

const cvr = read("src/lib/cvr.ts");
const enrichBatch = read("src/app/api/companies/enrich-batch/route.ts");
const aiCron = read("src/app/api/cron/ai-phone/route.ts");
const vercelJson = JSON.parse(read("vercel.json")) as {
  crons: { path: string; schedule: string }[];
};

describe("the AI pass is callable on its own", () => {
  it("is exported", () => {
    expect(cvr).toMatch(/export async function runAiPhonePass\(/);
  });

  it("takes its own limit and budget rather than inheriting the batch's", () => {
    expect(cvr).toMatch(/opts: \{ limit\?: number; budgetMs\?: number \}/);
  });

  it("builds its own Supabase client instead of being handed one", () => {
    // It used to receive the batch's client as an argument, which is what tied
    // it to enrichPendingCompanies.
    expect(cvr).not.toMatch(/runAiPhonePass\(\s*supabase\s*\)/);
  });
});

describe("the interactive batch does not run the AI pass", () => {
  it("never calls runAiPhonePass", () => {
    // The regression that caused the 300s hang: one request running all four
    // passes, including up to 15 web-search lookups at ~40s each.
    const callSite = /await runAiPhonePass\(/g;
    const calls = cvr.match(callSite) ?? [];
    expect(calls).toHaveLength(0);
  });

  it("keeps the AI block out of its summary type", () => {
    expect(cvr).toMatch(/Pass 4 \(AI phone lookup\) is deliberately NOT part of this summary/);
  });

  it("passes a wall-clock budget well inside maxDuration", () => {
    expect(enrichBatch).toMatch(/const BUDGET_MS = 200_000;/);
    expect(enrichBatch).toMatch(/enrichPendingCompanies\(\{ budgetMs: BUDGET_MS \}\)/);
    expect(enrichBatch).toMatch(/export const maxDuration = 300;/);
  });
});

describe("the AI pass has its own cron", () => {
  it("calls only runAiPhonePass, with a low cap and a budget", () => {
    expect(aiCron).toMatch(/runAiPhonePass\(\{ limit: LIMIT, budgetMs: BUDGET_MS \}\)/);
    expect(aiCron).toMatch(/const LIMIT = 5;/);
    expect(aiCron).toMatch(/const BUDGET_MS = 240_000;/);
    expect(aiCron).not.toMatch(/enrichPendingCompanies/);
  });

  it("uses the repo's timing-safe cron auth", () => {
    expect(aiCron).toMatch(/timingSafeEqual/);
    expect(aiCron).toMatch(/env\.cronSecret/);
    expect(aiCron).toMatch(/cron_not_configured/);
  });

  it("is scheduled, offset from the enrich cron so they don't overlap", () => {
    const paths = vercelJson.crons.map((c) => c.path);
    expect(paths).toContain("/api/cron/ai-phone");

    const ai = vercelJson.crons.find((c) => c.path === "/api/cron/ai-phone");
    const enrich = vercelJson.crons.find((c) => c.path === "/api/cron/enrich");
    expect(ai?.schedule).not.toBe(enrich?.schedule);
  });
});

describe("the batch stays inside its budget", () => {
  it("guards all three fast passes, not just one", () => {
    const guards = cvr.match(/shouldRunAnother\(startedAt, budgetMs, Date\.now\(\)/g) ?? [];
    // Three fast passes plus the AI pass's own guard.
    expect(guards.length).toBeGreaterThanOrEqual(4);
  });

  it("budgets the website pass for its real worst case", () => {
    // Homepage + up to MAX_SUBPAGES=4 subpages at FETCH_TIMEOUT_MS=10s each.
    expect(cvr).toMatch(/const WEBSITE_EXPECTED_MS = 52_000;/);
  });

  it("reports a short run instead of failing", () => {
    expect(cvr).toMatch(/stoppedOnTime: boolean;/);
    expect(cvr).toMatch(/stoppedOnTime = true;/);
  });
});

describe("the enrich-all button can't strand its spinner", () => {
  const button = read("src/components/leads/enrich-all-button.tsx");

  it("aborts a request that never settles", () => {
    expect(button).toMatch(/signal: AbortSignal\.timeout\(REQUEST_TIMEOUT_MS\)/);
  });

  it("resets running state in a finally, on every path", () => {
    expect(button).toMatch(/finally \{\s*setRunning\(false\);/);
  });

  it("tells the user which failure they hit", () => {
    expect(button).toMatch(/TimeoutError/);
    expect(button).toMatch(/enrichAllTimeout/);
  });
});
