/**
 * When an enrichment pass counts as "running" in the leads UI.
 *
 * PURE — no I/O, no `server-only`. Importable from RSCs, client components and
 * tests alike.
 *
 * A spinner in the contact column means "a job is running right now", and
 * nothing else. Only `queued` is a genuine in-flight state: the row has been
 * handed to something asynchronous and a result is expected back. `pending`
 * means "never attempted", which is where most rows sit forever — showing a
 * spinner for it is what once made "Henter data…" appear on every empty row.
 *
 * The rule this file exists for: a queued row must never spin forever. Whatever
 * was supposed to write the result back can die — an Actor run that crashes, a
 * webhook that never arrives, a deleted integration — and the status then stays
 * `queued` for good. So a queue older than QUEUED_TIMEOUT_MS is treated as
 * failed and rendered as an em dash. Krak was the pass this was written for and
 * it is gone, but the rule is deliberately source-agnostic: it applies to every
 * enrichment status on `companies`, including ones added later.
 */

/** How long a `queued` row may spin before the UI gives up on it. */
export const QUEUED_TIMEOUT_MS = 30 * 60 * 1000;

export type EnrichmentPass = {
  /** One enrichment status column, e.g. `cvr_enrichment_status`. */
  status: string;
  /**
   * When the row last changed, as an ISO timestamp — the best available proxy
   * for "when it was queued". Null when unknown, which counts as stale: with no
   * proof the queue is fresh, spinning forever is the failure mode being
   * prevented here.
   */
  since: string | null;
};

/** True only for a queue we can prove started less than 30 minutes ago. */
export function isPassRunning(pass: EnrichmentPass, nowMs: number): boolean {
  if (pass.status !== "queued") return false;
  if (!pass.since) return false;
  const startedAt = Date.parse(pass.since);
  if (Number.isNaN(startedAt)) return false;
  return nowMs - startedAt < QUEUED_TIMEOUT_MS;
}

/** True when any of a company's enrichment passes is genuinely in flight. */
export function hasRunningPass(
  passes: EnrichmentPass[],
  nowMs: number,
): boolean {
  return passes.some((pass) => isPassRunning(pass, nowMs));
}

/**
 * Every enrichment status a company row carries, paired with its timestamp.
 *
 * `updated_at` is used for all three: a status write is a write, so the
 * `set_updated_at` trigger moves it, and a row sitting untouched in `queued`
 * carries the moment it was queued. Another write to the same row pushes the
 * timeout out, which is acceptable — the point is that it is bounded.
 *
 * None of the three passes emits `queued` today (CVR and the website scraper
 * finish inside their batch; the AI pass finishes inside its own). This is the
 * guard for the next pass that does.
 */
export function companyEnrichmentPasses(company: CompanyEnrichmentFields): EnrichmentPass[] {
  const since = company.updated_at;
  return [
    { status: company.cvr_enrichment_status, since },
    { status: company.website_scrape_status, since },
    { status: company.ai_enrichment_status, since },
  ];
}

export type CompanyEnrichmentFields = {
  cvr_enrichment_status: string;
  website_scrape_status: string;
  ai_enrichment_status: string;
  updated_at: string | null;
};

/**
 * The one call the leads table makes: is anything running for this company?
 *
 * Reads the clock here rather than in the component, which the React compiler
 * forbids. Everything it delegates to takes the clock as an argument and is
 * unit-tested that way.
 */
export function isCompanyEnriching(company: CompanyEnrichmentFields): boolean {
  return hasRunningPass(companyEnrichmentPasses(company), Date.now());
}
