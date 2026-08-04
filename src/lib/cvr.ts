import "server-only";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { env } from "@/lib/env";
import { scrapeWebsiteContacts } from "@/lib/website-scraper";
import { applyAiPhoneResult, findPhoneViaAI } from "@/lib/ai-phone";
import { shouldRunAnother } from "@/lib/budget";
import type { CvrEnrichmentStatus } from "@/types/database";

// Free Danish CVR registry API. No account needed — just a valid User-Agent in
// the format "[company] - [project] - [contact]". 50 lookups/day/IP unless a
// CVRAPI_TOKEN is set (then we authenticate via HTTP Basic).
// Docs: https://cvrapi.dk/documentation
const CVR_API_URL = "https://cvrapi.dk/api";
const USER_AGENT = "Spotter - Lead enrichment - mvlm@evolugic.com";

interface CvrApiResponse {
  vat: number;
  name: string;
  protected: boolean;
  phone: string | null;
  email: string | null;
  industrycode: number | null;
  industrydesc: string | null;
  companycode: number;
  companydesc: string;
  creditbankrupt: boolean;
  owners: Array<{ name: string }> | null;
  error?: string;
}

export interface CvrEnrichmentResult {
  phone: string | null;
  email: string | null;
  contactPersonName: string | null;
  industryCode: number | null;
  industryText: string | null;
  companyType: string;
  isAdProtected: boolean;
  isBankrupt: boolean;
  cvrNumber: number;
}

type FetchOutcome =
  | "ok"
  | "not_found"
  | "quota"
  | "invalid_request"
  | "network_error";

function toResult(json: CvrApiResponse): CvrEnrichmentResult {
  return {
    phone: json.phone ?? null,
    email: json.email ?? null,
    contactPersonName: json.owners?.[0]?.name ?? null,
    industryCode: json.industrycode ?? null,
    industryText: json.industrydesc ?? null,
    companyType: json.companydesc,
    isAdProtected: Boolean(json.protected),
    isBankrupt: Boolean(json.creditbankrupt),
    cvrNumber: json.vat,
  };
}

// Single network call. Returns a structured outcome so callers can distinguish
// "no such company" (definitive) from transient failures (quota/network) that
// are worth retrying. Never throws.
async function cvrFetch(params: { vat?: string; name?: string }): Promise<{
  result: CvrEnrichmentResult | null;
  matchedName: string | null;
  outcome: FetchOutcome;
}> {
  const search = new URLSearchParams({ country: "dk" });
  if (params.vat) search.set("vat", params.vat);
  else if (params.name) search.set("name", params.name);

  const headers: Record<string, string> = {
    "User-Agent": USER_AGENT,
    Accept: "application/json",
  };
  if (env.cvrApiToken) {
    headers.Authorization = `Basic ${Buffer.from(`${env.cvrApiToken}:`).toString("base64")}`;
  }

  let json: CvrApiResponse;
  try {
    const res = await fetch(`${CVR_API_URL}?${search.toString()}`, {
      headers,
      cache: "no-store",
    });
    json = (await res.json()) as CvrApiResponse;
  } catch (err) {
    console.error("[cvr] network error:", err);
    return { result: null, matchedName: null, outcome: "network_error" };
  }

  if (json.error) {
    switch (json.error) {
      case "NOT_FOUND":
        return { result: null, matchedName: null, outcome: "not_found" };
      case "QUOTA_EXCEEDED":
        console.warn(
          "[cvr] QUOTA_EXCEEDED — daily lookup limit reached. Set CVRAPI_TOKEN to remove it.",
        );
        return { result: null, matchedName: null, outcome: "quota" };
      default:
        // INVALID_UA, INVALID_VAT, or anything else.
        console.error(`[cvr] API error: ${json.error}`);
        return { result: null, matchedName: null, outcome: "invalid_request" };
    }
  }

  return { result: toResult(json), matchedName: json.name ?? null, outcome: "ok" };
}

function normalizeName(value: string): string {
  return value
    .toLowerCase()
    .replace(/\b(aps|a\/s|i\/s|p\/s|ivs|k\/s|holding)\b/g, "")
    .replace(/[^a-z0-9æøå ]/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Name search is fuzzy, so only trust a result whose returned name reasonably
// matches what we asked for (after stripping company-form suffixes).
function namesMatch(input: string, matched: string | null): boolean {
  if (!matched) return false;
  const a = normalizeName(input);
  const b = normalizeName(matched);
  if (!a || !b) return false;
  return a === b || a.includes(b) || b.includes(a);
}

/** Look up a company by exact CVR number. Never throws; null on any failure. */
export async function lookupByCvr(
  cvrNumber: string,
): Promise<CvrEnrichmentResult | null> {
  return (await cvrFetch({ vat: cvrNumber })).result;
}

/** Look up by company name (fuzzy). Returns null if the match looks unreliable. */
export async function lookupByName(
  companyName: string,
): Promise<CvrEnrichmentResult | null> {
  const { result, matchedName } = await cvrFetch({ name: companyName });
  if (!result || !namesMatch(companyName, matchedName)) return null;
  return result;
}

// ---------------------------------------------------------------------------
// Website discovery (independent of CVR)
// ---------------------------------------------------------------------------
// The website scraper needs a `website` URL, but most leads arrive without one.
// We discover it from free signals that don't depend on CVR having run: the
// company email's domain, and any external company URL in the job postings.

// Free mailbox providers — their domain is never the company's own website.
const GENERIC_EMAIL_PROVIDERS = new Set([
  "gmail.com", "hotmail.com", "hotmail.dk", "outlook.com", "outlook.dk",
  "yahoo.com", "yahoo.dk", "live.dk", "live.com", "mail.dk", "icloud.com",
  "protonmail.com", "proton.me", "webmail.dk", "msn.com", "me.com", "aol.com",
]);

// Domains that are never a company's own site: job-board sources, Danish
// directories, social/search, and common ATS hosts. Reject these as guesses.
const NON_COMPANY_DOMAINS = new Set([
  "jobnet.dk", "jobindex.dk", "jobdanmark.dk", "indeed.com", "thehub.io",
  "linkedin.com", "randstad.dk", "glassdoor.com", "ofir.dk", "moment.dk",
  "stepstone.dk", "monster.dk", "jobfinder.dk",
  "cvr.dk", "virk.dk", "proff.dk", "krak.dk", "degulesider.dk", "findster.dk",
  "google.com", "facebook.com", "twitter.com", "x.com", "instagram.com",
  "youtube.com", "tiktok.com", "workable.com", "lever.co", "greenhouse.io",
]);

const DISCOVERY_UA =
  "Mozilla/5.0 (compatible; Spotter/1.0; +https://sbotter.vercel.app)";
const DISCOVERY_VERIFY_TIMEOUT_MS = 5000;
const DISCOVERY_BATCH_LIMIT = 40;
// Discovery hits each company's own domain once (distinct hosts), so a long
// delay just burns the function budget.
const DISCOVERY_DELAY_MS = 300;

function registrableDomain(host: string): string {
  return host.replace(/^www\./, "").toLowerCase().split(".").slice(-2).join(".");
}

// A registrable domain that plausibly belongs to the company itself.
function isCompanyDomain(reg: string): boolean {
  return (
    reg.includes(".") &&
    !GENERIC_EMAIL_PROVIDERS.has(reg) &&
    !NON_COMPANY_DOMAINS.has(reg)
  );
}

// The domain of an email, if it looks like a company domain. Null otherwise.
function companyDomainFromEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const at = email.lastIndexOf("@");
  if (at === -1) return null;
  const reg = registrableDomain(email.slice(at + 1).trim());
  return reg && isCompanyDomain(reg) ? reg : null;
}

// Distinct company-looking registrable domains found in arbitrary text.
function companyDomainsInText(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/https?:\/\/[^\s"'<>)\]}]+/gi)) {
    try {
      const reg = registrableDomain(new URL(m[0]).hostname);
      if (isCompanyDomain(reg)) out.add(reg);
    } catch {
      // ignore malformed URLs
    }
  }
  return [...out];
}

// Confirm a domain resolves to a live site. HEAD first (cheap), GET as a
// fallback (some servers reject HEAD), following www<->apex redirects. 5s cap.
async function domainResolves(domain: string): Promise<boolean> {
  for (const method of ["HEAD", "GET"] as const) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DISCOVERY_VERIFY_TIMEOUT_MS);
    try {
      const res = await fetch(`https://${domain}`, {
        method,
        redirect: "follow",
        signal: controller.signal,
        headers: { "User-Agent": DISCOVERY_UA },
      });
      if (res.ok) return true;
      if (method === "HEAD" && (res.status === 405 || res.status === 501)) continue;
      return false;
    } catch {
      if (method === "HEAD") continue; // hiccup on HEAD → try GET once
      return false;
    } finally {
      clearTimeout(timer);
    }
  }
  return false;
}

/**
 * Discover a company's website from its email domain (verified live). Free and
 * instant. Returns an https:// URL or null. Never throws. (companyName is kept
 * for a future SERP-based fallback; plain-fetch Google/Krak are bot-blocked.)
 */
export async function discoverCompanyWebsite(
  companyName: string,
  cvrEmail: string | null,
): Promise<string | null> {
  try {
    const domain = companyDomainFromEmail(cvrEmail);
    if (domain && (await domainResolves(domain))) return `https://${domain}`;
    void companyName;
    return null;
  } catch (err) {
    console.warn(
      `[discover] email lookup failed for "${companyName}":`,
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

/**
 * CVR-free discovery: scan a company's job postings (url, description, raw) for
 * an external company URL and return the first whose domain resolves. Job-board
 * / directory / social hosts are filtered out. Never throws.
 */
async function discoverWebsiteFromPostings(
  companyId: string,
): Promise<string | null> {
  try {
    const supabase = createSupabaseServiceClient();
    const { data: posts } = await supabase
      .from("job_postings")
      .select("url, description, raw")
      .eq("company_id", companyId)
      .order("created_at", { ascending: false })
      .limit(5);
    if (!posts?.length) return null;

    const candidates = new Set<string>();
    for (const p of posts) {
      if (p.url) companyDomainsInText(p.url).forEach((d) => candidates.add(d));
      if (p.description)
        companyDomainsInText(p.description).forEach((d) => candidates.add(d));
      if (p.raw)
        companyDomainsInText(JSON.stringify(p.raw)).forEach((d) =>
          candidates.add(d),
        );
    }
    // Cap live checks to keep the per-company budget bounded.
    for (const domain of [...candidates].slice(0, 5)) {
      if (await domainResolves(domain)) return `https://${domain}`;
    }
    return null;
  } catch (err) {
    console.warn(
      `[discover] postings scan failed for ${companyId}:`,
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

/**
 * Discover a website (email domain, then job postings) and, when found, store it
 * and re-queue it for scraping. Returns the website found, or null. Never throws.
 */
async function discoverAndStoreWebsite(
  companyId: string,
  companyName: string,
  email: string | null,
): Promise<string | null> {
  const website =
    (await discoverCompanyWebsite(companyName, email)) ??
    (await discoverWebsiteFromPostings(companyId));
  if (website) {
    const supabase = createSupabaseServiceClient();
    await supabase
      .from("companies")
      .update({ website, website_scrape_status: "pending" })
      .eq("id", companyId);
    console.log(`[discover] ${companyName} (${companyId}) → ${website}`);
  }
  return website;
}

// Inline discovery for the single-company path (enrichCompanyFromCvr): only acts
// when the row has no website yet. Never throws.
async function discoverWebsiteIfMissing(
  companyId: string,
  companyName: string,
  email: string | null,
): Promise<void> {
  try {
    const supabase = createSupabaseServiceClient();
    const { data } = await supabase
      .from("companies")
      .select("website")
      .eq("id", companyId)
      .single();
    if (data?.website) return;
    await discoverAndStoreWebsite(companyId, companyName, email);
  } catch {
    // best-effort; never block CVR enrichment on discovery
  }
}

export type EnrichResult = {
  status: CvrEnrichmentStatus;
  quotaExceeded: boolean;
  // Why a row ended up 'failed' (quota | network_error | invalid_request |
  // db_error), so batch callers can report the actual cause. null otherwise.
  reason: string | null;
};

/**
 * Enrich a single company row from CVR. Prefers exact CVR lookup, falls back to
 * name search. Writes results + status to the companies table. Never throws —
 * on transient failure it marks the row 'failed' (retryable); on a genuine miss
 * it marks 'no_match'. Returns the final status and whether the API quota was
 * hit (so batch callers can stop early).
 */
export async function enrichCompanyFromCvr(
  companyId: string,
  cvrNumber: string | null,
  companyName: string,
  options: { discoverWebsite?: boolean } = {},
): Promise<EnrichResult> {
  const supabase = createSupabaseServiceClient();

  try {
    let result: CvrEnrichmentResult | null = null;
    let outcome: FetchOutcome = "not_found";
    let foundViaName = false;

    if (cvrNumber) {
      const r = await cvrFetch({ vat: cvrNumber });
      result = r.result;
      outcome = r.outcome;
    } else {
      const r = await cvrFetch({ name: companyName });
      if (r.result && namesMatch(companyName, r.matchedName)) {
        result = r.result;
        outcome = "ok";
        foundViaName = true;
      } else {
        // A returned-but-mismatched name counts as a definitive miss.
        outcome = r.outcome === "ok" ? "not_found" : r.outcome;
      }
    }

    if (result) {
      await supabase
        .from("companies")
        .update({
          phone: result.phone,
          email: result.email,
          contact_person_name: result.contactPersonName,
          cvr_industry_code: result.industryCode,
          cvr_industry_text: result.industryText,
          cvr_company_type: result.companyType,
          is_ad_protected: result.isAdProtected,
          is_bankrupt: result.isBankrupt,
          cvr_enrichment_status: "enriched",
          cvr_enriched_at: new Date().toISOString(),
          // Backfill the CVR number we discovered via name search.
          ...(foundViaName ? { cvr: String(result.cvrNumber) } : {}),
        })
        .eq("id", companyId);

      // Discover a website (email domain, then job postings) if we don't have
      // one — the scraper depends on it. Skipped in batch (Pass 2 handles it).
      if (options.discoverWebsite !== false) {
        await discoverWebsiteIfMissing(companyId, companyName, result.email);
      }

      return { status: "enriched", quotaExceeded: false, reason: null };
    }

    // not_found / name-mismatch → no_match (definitive). Everything else
    // (quota, network, invalid) → failed (retryable).
    const status: CvrEnrichmentStatus =
      outcome === "not_found" ? "no_match" : "failed";
    if (status === "failed") {
      console.warn(
        `[cvr] ${companyName} (${companyId}) failed — reason: ${outcome}`,
      );
    }
    await supabase
      .from("companies")
      .update({ cvr_enrichment_status: status })
      .eq("id", companyId);
    return {
      status,
      quotaExceeded: outcome === "quota",
      reason: status === "failed" ? outcome : null,
    };
  } catch (err) {
    console.error(`[cvr] enrichment failed for company ${companyId}:`, err);
    try {
      await supabase
        .from("companies")
        .update({ cvr_enrichment_status: "failed" })
        .eq("id", companyId);
    } catch {
      // swallow — we already logged the original error
    }
    return { status: "failed", quotaExceeded: false, reason: "db_error" };
  }
}

// How many websites to scrape per batch run. Modest: each scrape can make up to
// 5 slow HTTP requests, and the cron/route budget is 300s.
const WEBSITE_BATCH_LIMIT = 20;

/**
 * Fallback enrichment from the company's own website. Scrapes the homepage + a
 * few contact/about subpages and stores the best phone, email, and named contact
 * in the website_* columns — it never overwrites CVR data (the UI falls back to
 * these only when the CVR field is null). Never throws: marks the row
 * 'no_website' when there's nothing to scrape, 'failed' on any error or empty
 * result, and 'scraped' on success.
 */
export async function enrichCompanyFromWebsite(
  companyId: string,
  websiteUrl: string | null,
): Promise<{ status: string }> {
  const supabase = createSupabaseServiceClient();

  try {
    if (!websiteUrl || !websiteUrl.trim()) {
      await supabase
        .from("companies")
        .update({ website_scrape_status: "no_website" })
        .eq("id", companyId);
      return { status: "no_website" };
    }

    const result = await scrapeWebsiteContacts(websiteUrl);
    const now = new Date().toISOString();

    if (!result) {
      await supabase
        .from("companies")
        .update({ website_scrape_status: "failed", website_scraped_at: now })
        .eq("id", companyId);
      return { status: "failed" };
    }

    // A Danish CVR number is also 8 digits — make sure we don't store the
    // company's own CVR as its "phone". Pick the first phone that isn't it.
    const { data: row } = await supabase
      .from("companies")
      .select("cvr")
      .eq("id", companyId)
      .single();
    const cvrDigits = row?.cvr?.replace(/\D/g, "") || null;
    const phone =
      result.phones.find((p) => p.replace(/\D/g, "") !== cvrDigits) ?? null;

    const person = result.contactPersons[0] ?? null;

    await supabase
      .from("companies")
      .update({
        website_phone: phone,
        website_email: result.emails[0] ?? null,
        website_contact_person: person?.name ?? null,
        website_contact_title: person?.title ?? null,
        website_scraped_at: now,
        website_scrape_status: "scraped",
      })
      .eq("id", companyId);

    return { status: "scraped" };
  } catch (err) {
    console.error(`[website] enrichment failed for company ${companyId}:`, err);
    try {
      await supabase
        .from("companies")
        .update({ website_scrape_status: "failed" })
        .eq("id", companyId);
    } catch {
      // swallow — we already logged the original error
    }
    return { status: "failed" };
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Wall-clock budget for the three fast passes, well inside the 300s function
// limit so the interactive button always gets a response.
const DEFAULT_FAST_BUDGET_MS = 200_000;
// Expected worst case per company, used to stop before starting work that
// can't finish. Pass 3 dominates: homepage + up to MAX_SUBPAGES=4 subpages at
// FETCH_TIMEOUT_MS=10s each, plus its 1.5s sleep.
const CVR_EXPECTED_MS = 3_000;
const DISCOVERY_EXPECTED_MS = 6_000;
const WEBSITE_EXPECTED_MS = 52_000;

// Pass 4 is capped low and paced slowly: every call runs web search, which is
// slow and billed per search on top of tokens. It runs on its own cron
// (/api/cron/ai-phone), NOT in the interactive enrich batch — a single lookup
// can take ~40s, so 15 of them would blow any request's time limit and leave
// the "Enrich all" button spinning forever.
const AI_BATCH_LIMIT = 5;
const AI_DELAY_MS = 2000;
/** Budget for a standalone AI pass, inside a 300s function. */
const DEFAULT_AI_BUDGET_MS = 240_000;
/** A web-search lookup plus its sleep. Used to stop before overshooting. */
const AI_EXPECTED_CALL_MS = 45_000;

/** The AI pass reports its own usage so the cost of the layer stays visible. */
export type AiPassSummary = {
  processed: number;
  enriched: number;
  noMatch: number;
  failed: number;
  remaining: number;
  skippedNoKey: boolean;
  /** ENABLE_AI_ENRICHMENT is off — the pass made no Anthropic call at all. */
  skippedDisabled: boolean;
  calls: number;
  webSearches: number;
  inputTokens: number;
  outputTokens: number;
  /** The wall-clock budget cut the loop short; the rest stays queued. */
  stoppedOnTime: boolean;
};

/**
 * Pass 4 — AI phone lookup for companies no other layer could reach.
 *
 * Independently callable: the enrichment batch no longer runs it, and
 * /api/cron/ai-phone calls only this. Selects only rows where phone, krak_phone
 * AND website_phone are all null and the AI lookup hasn't been tried. A no-op
 * with a log line when the layer is switched off or no API key is configured.
 *
 * Since the AI cron was unscheduled this only runs when someone invokes
 * /api/cron/ai-phone by hand, and only when ENABLE_AI_ENRICHMENT is on.
 */
export async function runAiPhonePass(
  opts: { limit?: number; budgetMs?: number } = {},
): Promise<AiPassSummary> {
  const supabase = createSupabaseServiceClient();
  const limit = opts.limit ?? AI_BATCH_LIMIT;
  const budgetMs = opts.budgetMs ?? DEFAULT_AI_BUDGET_MS;
  const startedAt = Date.now();
  const empty = {
    processed: 0,
    enriched: 0,
    noMatch: 0,
    failed: 0,
    remaining: 0,
    skippedNoKey: false,
    skippedDisabled: false,
    calls: 0,
    webSearches: 0,
    inputTokens: 0,
    outputTokens: 0,
    stoppedOnTime: false,
  };

  // Cost kill switch, checked before any query runs: off means the pass does
  // nothing at all — no selection, no status writes, no Anthropic call.
  if (!env.enableAiEnrichment) {
    console.log(
      "[ai] pass 4 skipped — ENABLE_AI_ENRICHMENT is off (set it to \"true\" to re-enable)",
    );
    return { ...empty, skippedDisabled: true };
  }

  if (!env.anthropicApiKey) {
    console.log("[ai] pass 4 skipped — ANTHROPIC_API_KEY not configured");
    return { ...empty, skippedNoKey: true };
  }

  // Retire companies that gained a phone from a trusted layer since their last
  // run, so they don't sit in the queue forever. Same shape as Pass 3's
  // retirement above.
  await supabase
    .from("companies")
    .update({ ai_enrichment_status: "skipped" })
    .eq("ai_enrichment_status", "pending")
    .or("phone.not.is.null,krak_phone.not.is.null,website_phone.not.is.null");

  const { data: needsAi } = await supabase
    .from("companies")
    .select("id, name, location_city, website")
    .is("phone", null)
    .is("krak_phone", null)
    .is("website_phone", null)
    .eq("ai_enrichment_status", "pending")
    .order("created_at", { ascending: true })
    .limit(limit);

  const aiList = needsAi ?? [];
  let aiEnriched = 0;
  let aiNoMatch = 0;
  let aiFailed = 0;
  let calls = 0;
  let webSearches = 0;
  let inputTokens = 0;
  let outputTokens = 0;

  let aiStoppedOnTime = false;
  for (let i = 0; i < aiList.length; i++) {
    // One lookup can take ~40s (web search + Opus). Stop before starting one we
    // can't finish inside the function's budget.
    if (!shouldRunAnother(startedAt, budgetMs, Date.now(), AI_EXPECTED_CALL_MS)) {
      aiStoppedOnTime = true;
      console.warn(`[ai] pass 4 stopping early at ${i}/${aiList.length} — out of budget`);
      break;
    }
    const c = aiList[i];
    const lookup = await findPhoneViaAI({
      name: c.name,
      city: c.location_city,
      website: c.website,
    });

    if (lookup) {
      calls++;
      webSearches += lookup.webSearches;
      inputTokens += lookup.inputTokens;
      outputTokens += lookup.outputTokens;
    }

    // A null lookup is a call that failed outright — record it as failed so it
    // is retried, rather than burning the company's one shot as no_match.
    const status = lookup
      ? await applyAiPhoneResult(c.id, lookup.result)
      : await markAiFailed(supabase, c.id);

    if (status === "enriched") aiEnriched++;
    else if (status === "no_match") aiNoMatch++;
    else if (status === "failed") aiFailed++;

    console.log(
      `[ai] batch ${i + 1}/${aiList.length} — ${c.name} (${c.id}) → ${status}` +
        (lookup ? ` (${lookup.webSearches} searches)` : ""),
    );

    if (i < aiList.length - 1) await sleep(AI_DELAY_MS);
  }

  const { count: aiRemaining } = await supabase
    .from("companies")
    .select("id", { count: "exact", head: true })
    .is("phone", null)
    .is("krak_phone", null)
    .is("website_phone", null)
    .eq("ai_enrichment_status", "pending");

  // The cost line: how many calls this batch made, how many web searches they
  // ran, and the tokens they burned.
  console.log(
    `[ai] pass 4 usage — ${calls} calls, ${webSearches} web searches, ` +
      `${inputTokens} in / ${outputTokens} out tokens`,
  );

  return {
    // What was actually attempted, not what was selected — the budget guard can
    // cut the loop short.
    processed: calls + aiFailed,
    enriched: aiEnriched,
    noMatch: aiNoMatch,
    failed: aiFailed,
    remaining: aiRemaining ?? 0,
    skippedNoKey: false,
    skippedDisabled: false,
    calls,
    webSearches,
    inputTokens,
    outputTokens,
    stoppedOnTime: aiStoppedOnTime,
  };
}

/** A lookup that never returned — mark it retryable. */
async function markAiFailed(
  supabase: ReturnType<typeof createSupabaseServiceClient>,
  companyId: string,
): Promise<"failed"> {
  await supabase
    .from("companies")
    .update({
      ai_enriched_at: new Date().toISOString(),
      ai_enrichment_status: "failed",
    })
    .eq("id", companyId);
  return "failed";
}

export type BatchEnrichSummary = {
  processed: number;
  enriched: number;
  failed: number;
  skipped: number;
  remaining: number;
  stoppedOnQuota: boolean;
  // Tally of why failures happened, e.g. { quota: 1 } or { invalid_request: 2 }.
  // Lets the UI explain "0 enriched, N failed" without server-log access.
  failureReasons: Record<string, number>;
  // Pass 2: website discovery (email domain / job postings), CVR-independent.
  discovery: { processed: number; discovered: number; remaining: number };
  // Pass 3: website scraping for companies that have a website and no phone yet.
  website: {
    processed: number;
    scraped: number;
    failed: number;
    noWebsite: number;
    remaining: number;
  };
  // The wall-clock budget cut a pass short. Anything not reached stays queued
  // for the next run, so this is a normal outcome, not an error.
  stoppedOnTime: boolean;
  // NOTE: Pass 4 (AI phone lookup) is deliberately NOT part of this summary.
  // It runs on its own cron via runAiPhonePass() — see the comment on
  // AI_BATCH_LIMIT.
};

/**
 * Run the three FAST enrichment passes: CVR lookup, website discovery, website
 * scrape. Used by the manual batch endpoint and the enrich cron.
 *
 * The AI phone lookup (Pass 4) is NOT run here — it lives on its own cron, see
 * runAiPhonePass().
 *
 * Bounded by a wall-clock budget rather than by row caps alone. Caps don't
 * bound the loop on their own: the website pass fetches a homepage plus up to 4
 * subpages at a 10s timeout each, so one slow company can take ~50s. The budget
 * is checked between companies and reported as `stoppedOnTime`, so a run always
 * fits inside the function's limit and says when it didn't finish.
 *
 * Batch size: 40 without a token, 200 with CVRAPI_TOKEN (no quota).
 */
export async function enrichPendingCompanies(
  opts: { budgetMs?: number } = {},
): Promise<BatchEnrichSummary> {
  const supabase = createSupabaseServiceClient();
  const limit = env.cvrApiToken ? 200 : 40;
  const budgetMs = opts.budgetMs ?? DEFAULT_FAST_BUDGET_MS;
  const startedAt = Date.now();
  let stoppedOnTime = false;

  const { data: companies, error } = await supabase
    .from("companies")
    .select("id, cvr, name")
    .in("cvr_enrichment_status", ["pending", "failed"])
    .order("created_at", { ascending: true })
    .limit(limit);

  if (error) {
    throw new Error(`Failed to load companies to enrich: ${error.message}`);
  }

  let enriched = 0;
  let failed = 0;
  let skipped = 0;
  let stoppedOnQuota = false;
  const failureReasons: Record<string, number> = {};
  const total = companies?.length ?? 0;

  for (let i = 0; i < total; i++) {
    if (!shouldRunAnother(startedAt, budgetMs, Date.now(), CVR_EXPECTED_MS)) {
      stoppedOnTime = true;
      console.warn(`[cvr] pass 1 stopping early at ${i}/${total} — out of budget`);
      break;
    }
    const c = companies![i];
    const { status, quotaExceeded, reason } = await enrichCompanyFromCvr(
      c.id,
      c.cvr,
      c.name,
      { discoverWebsite: false },
    );
    if (status === "enriched") enriched++;
    else if (status === "no_match") skipped++;
    else {
      failed++;
      const key = reason ?? "unknown";
      failureReasons[key] = (failureReasons[key] ?? 0) + 1;
    }

    console.log(
      `[cvr] batch ${i + 1}/${total} — ${c.name} (${c.id}) → ${status}`,
    );

    if (quotaExceeded) {
      console.warn("[cvr] batch stopping early: daily quota exceeded");
      stoppedOnQuota = true;
      break;
    }
    if (i < total - 1) await sleep(1000);
  }

  const { count: remaining } = await supabase
    .from("companies")
    .select("id", { count: "exact", head: true })
    .in("cvr_enrichment_status", ["pending", "failed"]);

  // The website passes below run regardless of CVR's outcome (quota included),
  // so a blocked CVR never stalls website discovery or scraping.

  // Retire companies that already have a phone (CVR or Krak) from the website
  // queue — no scrape needed.
  await supabase
    .from("companies")
    .update({ website_scrape_status: "skipped" })
    .eq("website_scrape_status", "pending")
    .or("phone.not.is.null,krak_phone.not.is.null");

  // --- Pass 2: discover a website for companies that have none ----------------
  // CVR-independent: tries the email domain, then external URLs in the job
  // postings. Companies where nothing is found are marked 'no_website' so they
  // aren't retried every run. A discovered site stays 'pending' for Pass 3.
  const { data: needsDiscovery } = await supabase
    .from("companies")
    .select("id, name, email, website_email")
    .is("website", null)
    .eq("website_scrape_status", "pending")
    .order("created_at", { ascending: true })
    .limit(DISCOVERY_BATCH_LIMIT);

  const discList = needsDiscovery ?? [];
  let discovered = 0;
  for (let i = 0; i < discList.length; i++) {
    if (!shouldRunAnother(startedAt, budgetMs, Date.now(), DISCOVERY_EXPECTED_MS)) {
      stoppedOnTime = true;
      console.warn(
        `[cvr] pass 2 stopping early at ${i}/${discList.length} — out of budget`,
      );
      break;
    }
    const c = discList[i];
    const website = await discoverAndStoreWebsite(
      c.id,
      c.name,
      c.email ?? c.website_email,
    );
    if (website) discovered++;
    else
      await supabase
        .from("companies")
        .update({ website_scrape_status: "no_website" })
        .eq("id", c.id);
    if (i < discList.length - 1) await sleep(DISCOVERY_DELAY_MS);
  }

  const { count: discRemaining } = await supabase
    .from("companies")
    .select("id", { count: "exact", head: true })
    .is("website", null)
    .eq("website_scrape_status", "pending");

  // --- Pass 3: scrape the website for a phone/contact -------------------------
  // CVR-independent: any company with a website, no CVR phone, still 'pending'.
  const { data: needsWebsite } = await supabase
    .from("companies")
    .select("id, website")
    .is("phone", null)
    .not("website", "is", null)
    .eq("website_scrape_status", "pending")
    .order("created_at", { ascending: true })
    .limit(WEBSITE_BATCH_LIMIT);

  const webList = needsWebsite ?? [];
  let webScraped = 0;
  let webFailed = 0;
  let webNoWebsite = 0;
  for (let i = 0; i < webList.length; i++) {
    // The expensive one: homepage + up to MAX_SUBPAGES subpages at a 10s
    // timeout each, so budget for the realistic worst case.
    if (!shouldRunAnother(startedAt, budgetMs, Date.now(), WEBSITE_EXPECTED_MS)) {
      stoppedOnTime = true;
      console.warn(
        `[website] pass 3 stopping early at ${i}/${webList.length} — out of budget`,
      );
      break;
    }
    const company = webList[i];
    const { status } = await enrichCompanyFromWebsite(company.id, company.website);
    if (status === "scraped") webScraped++;
    else if (status === "no_website") webNoWebsite++;
    else webFailed++;
    console.log(
      `[website] batch ${i + 1}/${webList.length} — ${company.id} → ${status}`,
    );
    if (i < webList.length - 1) await sleep(1500);
  }

  const { count: webRemaining } = await supabase
    .from("companies")
    .select("id", { count: "exact", head: true })
    .is("phone", null)
    .not("website", "is", null)
    .eq("website_scrape_status", "pending");

  const summary: BatchEnrichSummary = {
    processed: total,
    enriched,
    failed,
    skipped,
    remaining: remaining ?? 0,
    stoppedOnQuota,
    failureReasons,
    discovery: {
      processed: discList.length,
      discovered,
      remaining: discRemaining ?? 0,
    },
    website: {
      processed: webList.length,
      scraped: webScraped,
      failed: webFailed,
      noWebsite: webNoWebsite,
      remaining: webRemaining ?? 0,
    },
    stoppedOnTime,
  };
  console.log("[cvr] batch summary:", JSON.stringify(summary));
  return summary;
}
