import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Structural checks on the contact-column loading state.
 *
 * The component is a client component with hooks and no DOM environment is
 * configured (see vitest.config.ts), so this reads the source instead — same
 * approach as enrich-passes.test.ts. What it pins is the regression itself:
 * the spinner was keyed off `cvr_enrichment_status === "pending"`, which means
 * "never attempted", so "Henter data…" showed on every empty row forever.
 *
 * The decision itself is made on the server and unit-tested in
 * src/lib/leads/enrich-state.test.ts; this only pins the wiring.
 */

const root = join(import.meta.dirname, "..", "..", "..");
const source = readFileSync(
  join(root, "src/components/leads/enrich-status.tsx"),
  "utf8",
);
const table = readFileSync(
  join(root, "src/components/leads/companies-table.tsx"),
  "utf8",
);

describe("the contact column only spins for a job that is actually running", () => {
  it("never branches on a pending status", () => {
    // The doc comment names the old behaviour, so match a branch, not a
    // mention: `if (status === "pending" ...)` is what must not come back.
    expect(source).not.toMatch(/if \(status === "pending"/);
  });

  it("spins on the server's verdict rather than on a raw status", () => {
    expect(source).toMatch(/if \(running && !busy\)/);
  });

  it("renders an em dash for every non-actionable state", () => {
    expect(source).toMatch(/const Dash = \(\) =>/);
    expect(source).toMatch(
      /if \(status !== "failed" && status !== "no_match" && !busy\) return <Dash \/>;/,
    );
  });

  it("keeps the retry affordance for outcomes you can act on", () => {
    expect(source).toMatch(/\/api\/companies\/\$\{companyId\}\/enrich/);
    expect(source).toMatch(/t\("retry"\)/);
  });

  it("is handed the verdict by the table, computed over every pass", () => {
    expect(table).toMatch(/running=\{isCompanyEnriching\(row\)\}/);
  });

  it("no longer knows about Krak", () => {
    expect(source).not.toMatch(/krak/i);
    expect(table).not.toMatch(/krak/i);
  });
});
