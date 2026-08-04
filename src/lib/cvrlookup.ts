import "server-only";
import { env } from "@/lib/env";
import {
  BATCH_MAX_CVRS,
  RATE_LIMIT_PER_MINUTE,
  namesMatch,
  toResult,
  type CvrLookupCompany,
  type CvrLookupOutcome,
  type CvrLookupResult,
} from "@/lib/cvrlookup-core";

// The mapping rules, the coalesce rule and the sizing constants are pure, and
// live in cvrlookup-core.ts so they can be tested without a network. Re-exported
// so callers have a single import site for the provider.
export {
  BATCH_CHUNK_SIZE,
  BATCH_MAX_CVRS,
  RATE_LIMIT_PER_MINUTE,
  buildCvrUpdate,
  isBlockingOutcome,
  toDirectors,
  type CurrentCvrColumns,
  type CvrDirector,
  type CvrLookupOutcome,
  type CvrLookupResult,
} from "@/lib/cvrlookup-core";

/**
 * Client for cvrlookup.dk — the CVR data provider that replaced cvrapi.dk.
 *
 * Why the switch: cvrapi.dk allowed 50 lookups/day/IP with no batching. This
 * provider gives 25.000 lookups/month, a batch endpoint that takes up to 50 CVR
 * numbers per call, and fields the old one never returned (employee counts,
 * signature rule, direktion, advertising protection).
 *
 * Field names and the batch request body below are taken from the provider's
 * published OpenAPI document at https://cvrlookup.dk/openapi.json, not guessed.
 * Two things there are worth knowing before changing this file:
 *
 *  1. The batch body key is `cvrs` (NOT `cvrNumbers`), and duplicates are
 *     removed server-side.
 *  2. Every CVR in a batch consumes one unit of BOTH the monthly quota and the
 *     per-minute limit. A 50-CVR batch against a 20/minute plan therefore stops
 *     itself two-fifths of the way through — see BATCH_CHUNK_SIZE.
 *
 * The batch endpoint requires the provider's Basic or Pro plan; on Free it
 * answers 403 FORBIDDEN, which surfaces as the `forbidden` outcome so the
 * enrichment pass stops cleanly instead of retrying every company.
 *
 * Run scripts/probe-cvrlookup.mjs with a real key to re-verify all of this
 * against the live API.
 */

const API_BASE = "https://cvrlookup.dk/api/v1";

interface BatchData {
  results: Array<{
    cvr: string;
    found: boolean;
    company?: CvrLookupCompany;
    error?: boolean;
  }>;
  requested: number;
  returned: number;
  errors: number;
  /** Set when a limit cut the batch short before every CVR was processed. */
  stoppedReason?: "quota" | "rate_limit" | null;
  /** The monthly quota ran out during this batch. */
  quotaExhausted?: boolean;
}

interface SearchData {
  companies: Array<{ cvr: string; companyName: string; isActive?: boolean }>;
}

type Envelope<T> =
  | { success: true; data: T }
  | { success: false; error: { code: string; message: string } };

// ---------------------------------------------------------------------------
// Rate limiting
// ---------------------------------------------------------------------------

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Rolling per-minute budget, tracked in-process.
 *
 * Best-effort by nature: a second serverless instance has its own counter. It
 * exists to keep a single enrichment run inside the limit; the 429 handling in
 * `apiFetch` is what actually guarantees correctness when it is wrong.
 */
let windowStartedAt = 0;
let unitsUsedInWindow = 0;

const RATE_LIMIT_WINDOW_MS = 60_000;

/** Reserve `units` of the per-minute budget, waiting for the reset if needed. */
async function reserveRateLimit(units: number, now = Date.now()): Promise<void> {
  if (now - windowStartedAt >= RATE_LIMIT_WINDOW_MS) {
    windowStartedAt = now;
    unitsUsedInWindow = 0;
  }

  if (unitsUsedInWindow + units > RATE_LIMIT_PER_MINUTE) {
    const waitMs = RATE_LIMIT_WINDOW_MS - (now - windowStartedAt);
    if (waitMs > 0) {
      console.log(`[cvrlookup] per-minute limit reached — waiting ${waitMs}ms`);
      await sleep(waitMs);
    }
    windowStartedAt = Date.now();
    unitsUsedInWindow = 0;
  }

  unitsUsedInWindow += units;
}

/** Test seam: forget the current rolling window. */
export function resetRateLimitWindow(): void {
  windowStartedAt = 0;
  unitsUsedInWindow = 0;
}

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

const MAX_RATE_LIMIT_RETRIES = 2;

type ApiResponse<T> = { data: T | null; outcome: CvrLookupOutcome };

/**
 * One authenticated call. Never throws.
 *
 * A 429 is retried after waiting out the window rather than failing the run —
 * hitting the rate limit is an expected condition on a big batch, not an error.
 * A 429 carrying QUOTA_EXCEEDED is NOT retried: the monthly quota is gone and
 * waiting a minute changes nothing.
 */
async function apiFetch<T>(
  path: string,
  init: RequestInit = {},
  attempt = 0,
): Promise<ApiResponse<T>> {
  const apiKey = env.cvrLookupApiKey;
  if (!apiKey) {
    console.warn("[cvrlookup] CVRLOOKUP_API_KEY is not configured");
    return { data: null, outcome: "unauthorized" };
  }

  let res: Response;
  let json: Envelope<T>;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...init.headers,
      },
      cache: "no-store",
    });
    json = (await res.json()) as Envelope<T>;
  } catch (err) {
    console.error("[cvrlookup] network error:", err);
    return { data: null, outcome: "network_error" };
  }

  if (res.ok && json.success) return { data: json.data, outcome: "ok" };

  const code = !json.success ? json.error?.code : undefined;

  if (res.status === 429) {
    if (code === "QUOTA_EXCEEDED") {
      console.warn("[cvrlookup] monthly quota exhausted");
      return { data: null, outcome: "quota" };
    }
    if (attempt < MAX_RATE_LIMIT_RETRIES) {
      console.warn(
        `[cvrlookup] rate limited — waiting ${RATE_LIMIT_WINDOW_MS}ms then retrying ` +
          `(attempt ${attempt + 1}/${MAX_RATE_LIMIT_RETRIES})`,
      );
      await sleep(RATE_LIMIT_WINDOW_MS);
      resetRateLimitWindow();
      return apiFetch<T>(path, init, attempt + 1);
    }
    return { data: null, outcome: "rate_limit" };
  }

  switch (res.status) {
    case 404:
      return { data: null, outcome: "not_found" };
    case 401:
      console.error("[cvrlookup] API key rejected — check CVRLOOKUP_API_KEY");
      return { data: null, outcome: "unauthorized" };
    case 403:
      // Batch and advanced search need the provider's Basic/Pro plan.
      console.warn(`[cvrlookup] forbidden for ${path} — plan may not allow it`);
      return { data: null, outcome: "forbidden" };
    case 400:
      console.error(`[cvrlookup] invalid request for ${path}: ${code}`);
      return { data: null, outcome: "invalid_request" };
    default:
      console.error(`[cvrlookup] HTTP ${res.status} for ${path}: ${code}`);
      return { data: null, outcome: "server_error" };
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Look up one company by CVR number. Never throws. */
export async function lookupByCvr(
  cvrNumber: string,
): Promise<{ result: CvrLookupResult | null; outcome: CvrLookupOutcome }> {
  const cvr = cvrNumber.replace(/\D/g, "");
  if (cvr.length !== 8) return { result: null, outcome: "invalid_request" };

  await reserveRateLimit(1);
  const { data, outcome } = await apiFetch<CvrLookupCompany>(`/company/${cvr}`);
  return { result: data ? toResult(data) : null, outcome };
}

export type BatchLookup = {
  /** Mapped results by CVR number, for the companies that were found. */
  found: Map<string, CvrLookupResult>;
  /** CVRs the provider processed and confirmed it has no company for. */
  notFound: string[];
  /** CVRs the provider never got to (a limit cut the batch short). */
  unprocessed: string[];
  outcome: CvrLookupOutcome;
  /** The monthly quota ran out during this batch — stop the whole run. */
  quotaExhausted: boolean;
};

/**
 * Look up up to BATCH_MAX_CVRS companies in one call.
 *
 * Partial success is normal, not an error: when a limit interrupts the batch the
 * provider still answers 200 with the results it managed, and the rest come back
 * as `unprocessed` for the next run. Unprocessed CVRs are not billed.
 */
export async function lookupBatch(cvrNumbers: string[]): Promise<BatchLookup> {
  const cvrs = [...new Set(cvrNumbers.map((c) => c.replace(/\D/g, "")))].filter(
    (c) => c.length === 8,
  );

  const empty: BatchLookup = {
    found: new Map(),
    notFound: [],
    unprocessed: cvrs,
    outcome: "ok",
    quotaExhausted: false,
  };
  if (cvrs.length === 0) return { ...empty, unprocessed: [] };

  await reserveRateLimit(cvrs.length);
  const { data, outcome } = await apiFetch<BatchData>("/company/batch", {
    method: "POST",
    body: JSON.stringify({ cvrs: cvrs.slice(0, BATCH_MAX_CVRS) }),
  });

  if (!data) return { ...empty, outcome };

  const found = new Map<string, CvrLookupResult>();
  const notFound: string[] = [];
  const processed = new Set<string>();

  for (const entry of data.results ?? []) {
    processed.add(entry.cvr);
    // `error: true` is a per-row failure — the CVR is retryable, so it counts as
    // neither found nor definitively missing.
    if (entry.error) continue;
    if (entry.found && entry.company) found.set(entry.cvr, toResult(entry.company));
    else if (!entry.found) notFound.push(entry.cvr);
  }

  const unprocessed = cvrs.filter((c) => !processed.has(c));
  if (data.stoppedReason) {
    console.warn(
      `[cvrlookup] batch stopped early (${data.stoppedReason}) — ` +
        `${unprocessed.length} of ${cvrs.length} CVRs left for the next run`,
    );
  }

  return {
    found,
    notFound,
    unprocessed,
    outcome: "ok",
    quotaExhausted: Boolean(data.quotaExhausted),
  };
}

/**
 * Resolve a company name to a CVR number, for rows ingested without one.
 *
 * Search returns identity data only, so this costs one unit here and another on
 * the follow-up lookup. Returns null when nothing matches confidently enough.
 */
export async function findCvrByName(
  companyName: string,
): Promise<{ cvr: string | null; outcome: CvrLookupOutcome }> {
  const q = companyName.trim().slice(0, 100);
  if (!q) return { cvr: null, outcome: "invalid_request" };

  await reserveRateLimit(1);
  const { data, outcome } = await apiFetch<SearchData>(
    `/company/search?q=${encodeURIComponent(q)}&limit=5&status=active`,
  );
  if (!data) return { cvr: null, outcome };

  const match = (data.companies ?? []).find((c) =>
    namesMatch(companyName, c.companyName),
  );
  return { cvr: match?.cvr ?? null, outcome: match ? "ok" : "not_found" };
}
