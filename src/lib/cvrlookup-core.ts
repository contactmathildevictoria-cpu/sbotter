/**
 * cvrlookup.dk response mapping and the rules that guard it.
 *
 * PURE. No I/O, no Supabase, no `server-only`. Everything that decides what a
 * provider response is allowed to turn into lives here so it can be tested
 * against fabricated payloads; `cvrlookup.ts` is the thin wrapper that makes
 * the HTTP calls, and `cvr.ts` writes the rows.
 *
 * Two rules this file enforces:
 *
 *  1. PRIVACY — the provider returns board members with private home addresses.
 *     `toDirectors` is the only path people data takes into our shape, and it
 *     rebuilds each entry from an allowlist so an address cannot survive.
 *  2. COALESCE — `buildCvrUpdate` never overwrites a column that already has a
 *     value. Enrichment fills gaps; it does not replace what is there.
 *
 * Field names come from the provider's published OpenAPI document
 * (https://cvrlookup.dk/openapi.json), verified with scripts/probe-cvrlookup.mjs.
 */

import type { CvrDirector } from "@/types/database";

export type { CvrDirector };

/** Provider hard cap on one batch call. */
export const BATCH_MAX_CVRS = 50;

/**
 * Lookups allowed per minute. The provider reports the plan's real value at
 * GET /api/v1/usage (`quota.rateLimit.perMinute`, free to call); this is the
 * conservative default we pace against without spending a call to find out.
 */
export const RATE_LIMIT_PER_MINUTE = 20;

/**
 * How many CVR numbers we actually put in one batch call.
 *
 * The provider caps a batch at 50, but each CVR in it also costs one unit of
 * the per-minute limit. Sending 50 against a 20/minute plan means the provider
 * processes ~20, returns 200 with `stoppedReason: "rate_limit"`, and leaves the
 * other 30 untouched — correct, but it takes three round trips to do what two
 * full chunks would. Pacing at the per-minute limit makes every call complete.
 *
 * Derived rather than hard-coded, so raising RATE_LIMIT_PER_MINUTE on a bigger
 * plan grows the chunk up to the provider's cap of 50 on its own.
 */
export const BATCH_CHUNK_SIZE = Math.min(BATCH_MAX_CVRS, RATE_LIMIT_PER_MINUTE);

// ---------------------------------------------------------------------------
// Wire types — only the fields we map. The provider returns far more.
// ---------------------------------------------------------------------------

/**
 * One entry of the provider's `boardMembers[]`.
 *
 * PRIVACY: the real payload also carries `address` — the person's private home
 * address. It is deliberately NOT declared here, so no code in this repo can
 * reach it off a typed value.
 */
export interface CvrLookupBoardMember {
  name?: string | null;
  role?: string | null;
  title?: string | null;
}

export interface CvrLookupCompany {
  cvr: string;
  companyName: string;
  status?: string | null;
  isActive?: boolean | null;
  companyType?: {
    shortDescription?: string | null;
    longDescription?: string | null;
  } | null;
  industry?: { code?: string | null; description?: string | null } | null;
  employeeInfo?: {
    employees?: number | null;
    employeeInterval?: string | null;
  } | null;
  contact?: { phone?: string | null; email?: string | null } | null;
  signatureRule?: string | null;
  boardMembers?: CvrLookupBoardMember[] | null;
  advertisingProtection?: boolean | null;
}

export interface CvrLookupResult {
  cvrNumber: string;
  companyName: string;
  phone: string | null;
  email: string | null;
  advertisingProtection: boolean | null;
  employeeCount: number | null;
  employeeInterval: string | null;
  directors: CvrDirector[];
  signatureRule: string | null;
  industryCode: number | null;
  industryText: string | null;
  companyType: string | null;
  isBankrupt: boolean;
}

/**
 * Outcomes a caller needs to tell apart. `not_found` is definitive (there is no
 * such company); `quota` and `rate_limit` mean "come back later" and must not
 * burn the company's enrichment attempt; the rest are transient or config
 * problems worth retrying.
 */
export type CvrLookupOutcome =
  | "ok"
  | "not_found"
  | "quota"
  | "rate_limit"
  | "forbidden"
  | "unauthorized"
  | "invalid_request"
  | "server_error"
  | "network_error";

/** True for outcomes where retrying later is pointless until something changes. */
export function isBlockingOutcome(outcome: CvrLookupOutcome): boolean {
  return (
    outcome === "quota" || outcome === "unauthorized" || outcome === "forbidden"
  );
}

// ---------------------------------------------------------------------------
// Mapping
// ---------------------------------------------------------------------------

/** Exact role that marks a person as direktion. */
const DIRECTOR_ROLE = "direktion";

/**
 * Direktion members, reduced to { name, title }.
 *
 * PRIVACY — this function is the single place the provider's people data is
 * allowed through, and it is deliberately strict:
 *
 *  - Only `role === "Direktion"` survives. Bestyrelse, suppleanter and every
 *    other role are dropped entirely. The comparison is exact (after trimming
 *    and lower-casing), never a substring match, so "Direktørsuppleant" and
 *    friends cannot slip through.
 *  - Each entry is REBUILT from two named fields. Nothing is spread or deleted,
 *    so the private `address` the provider sends on every board member cannot
 *    survive into the return value, into the database, or into a log line —
 *    even if the provider adds more personal fields later.
 *
 * Do not rewrite this as `{ ...member }` minus address.
 */
export function toDirectors(
  boardMembers: CvrLookupBoardMember[] | null | undefined,
): CvrDirector[] {
  if (!Array.isArray(boardMembers)) return [];

  const directors: CvrDirector[] = [];
  for (const member of boardMembers) {
    if (!member) continue;
    if (member.role?.trim().toLowerCase() !== DIRECTOR_ROLE) continue;

    const name = member.name?.trim();
    if (!name) continue;

    const title = member.title?.trim();
    directors.push({ name, title: title ? title : null });
  }
  return directors;
}

/** Industry codes arrive as strings ("622000"); our column is an integer. */
function toIndustryCode(code: string | null | undefined): number | null {
  if (!code) return null;
  const parsed = Number.parseInt(code, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

export function toResult(company: CvrLookupCompany): CvrLookupResult {
  return {
    cvrNumber: company.cvr,
    companyName: company.companyName,
    phone: company.contact?.phone?.trim() || null,
    email: company.contact?.email?.trim() || null,
    advertisingProtection: company.advertisingProtection ?? null,
    employeeCount: company.employeeInfo?.employees ?? null,
    employeeInterval: company.employeeInfo?.employeeInterval?.trim() || null,
    directors: toDirectors(company.boardMembers),
    signatureRule: company.signatureRule?.trim() || null,
    industryCode: toIndustryCode(company.industry?.code),
    industryText: company.industry?.description?.trim() || null,
    companyType:
      company.companyType?.longDescription?.trim() ||
      company.companyType?.shortDescription?.trim() ||
      null,
    isBankrupt: company.status === "BANKRUPTCY",
  };
}

// ---------------------------------------------------------------------------
// Name matching
// ---------------------------------------------------------------------------

export function normalizeName(value: string): string {
  return value
    .toLowerCase()
    .replace(/\b(aps|a\/s|i\/s|p\/s|ivs|k\/s|holding)\b/g, "")
    .replace(/[^a-z0-9æøå ]/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Name search is fuzzy — only trust a result that really looks like a match. */
export function namesMatch(input: string, matched: string): boolean {
  const a = normalizeName(input);
  const b = normalizeName(matched);
  if (!a || !b) return false;
  return a === b || a.includes(b) || b.includes(a);
}

// ---------------------------------------------------------------------------
// Coalesced update
// ---------------------------------------------------------------------------

/** The current values of the columns CVR enrichment may touch. */
export type CurrentCvrColumns = Record<string, unknown>;

/**
 * Build the update for one company from a lookup result.
 *
 * COALESCE semantics: a column is written only when it is currently null, so a
 * value a user or another enrichment pass already put there is never
 * overwritten. A null in the incoming result is likewise never written over an
 * existing value — the provider not knowing something is not evidence that our
 * stored value is wrong.
 *
 * The two not-null booleans can't express "unknown", so they get a narrower
 * rule: they may flip false → true, never true → false. Under-reporting
 * reklamebeskyttelse is the expensive direction, since it gates who we may call.
 */
export function buildCvrUpdate(
  current: CurrentCvrColumns,
  result: CvrLookupResult,
): Record<string, unknown> {
  const directors = result.directors.length ? result.directors : null;

  const incoming: Record<string, unknown> = {
    // Shared contact columns — what the leads cascade and the CSV export read.
    phone: result.phone,
    email: result.email,
    // The direktion is the closest thing CVR has to a named contact.
    contact_person_name: directors?.[0]?.name ?? null,
    // Provider-specific copies, so a later source overwriting `phone` doesn't
    // lose what CVR said.
    cvr_phone: result.phone,
    cvr_email: result.email,
    cvr_advertising_protection: result.advertisingProtection,
    cvr_employee_count: result.employeeCount,
    cvr_employee_interval: result.employeeInterval,
    cvr_directors: directors,
    cvr_signature_rule: result.signatureRule,
    cvr_industry_code: result.industryCode,
    cvr_industry_text: result.industryText,
    cvr_company_type: result.companyType,
  };

  const update: Record<string, unknown> = {};
  for (const [column, value] of Object.entries(incoming)) {
    if (value === null || value === undefined) continue;
    if (current[column] == null) update[column] = value;
  }

  if (result.advertisingProtection === true && current.is_ad_protected !== true) {
    update.is_ad_protected = true;
  }
  if (result.isBankrupt && current.is_bankrupt !== true) {
    update.is_bankrupt = true;
  }

  return update;
}
