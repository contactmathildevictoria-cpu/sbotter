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

  it("spins for the one genuine in-flight state in the schema", () => {
    // Krak is the only pass that queues work with a third party and comes back
    // later; CVR and the website scraper are synchronous within a batch.
    expect(source).toMatch(/krakStatus === "queued"/);
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

  it("is handed the Krak status by the table", () => {
    expect(table).toMatch(/krakStatus=\{row\.krak_enrichment_status\}/);
  });
});
