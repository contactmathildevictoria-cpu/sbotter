import "server-only";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { env } from "@/lib/env";
import { scrapeWebsiteContacts } from "@/lib/website-scraper";
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
// Website discovery
// ---------------------------------------------------------------------------
// Most leads come from job boards where the posting URL isn't the company's own
// site, so `companies.website` is usually null — yet the website scraper needs
// it. We discover it cheaply from the company's email domain.

// Free mailbox providers — their domain is never the company's own website.
const GENERIC_EMAIL_PROVIDERS = new Set([
  "gmail.com", "hotmail.com", "hotmail.dk", "outlook.com", "outlook.dk",
  "yahoo.com", "yahoo.dk", "live.dk", "live.com", "mail.dk", "icloud.com",
  "protonmail.com", "proton.me", "webmail.dk", "msn.com", "me.com", "aol.com",
]);

// Domains that are never a company's own site: our job-board sources plus Danish
// business directories and social networks. Used to reject bad website guesses
// (and, once a SERP-based Strategy B is added, to filter its results).
const NON_COMPANY_DOMAINS = new Set([
  // job boards / ingest sources
  "jobnet.dk", "jobindex.dk", "jobdanmark.dk", "indeed.com", "thehub.io",
  "linkedin.com", "randstad.dk", "glassdoor.com", "ofir.dk", "moment.dk",
  "stepstone.dk", "monster.dk", "jobfinder.dk",
  // directories / registries
  "cvr.dk", "virk.dk", "proff.dk", "krak.dk", "degulesider.dk", "findster.dk",
  // search / social
  "google.com", "facebook.com", "twitter.com", "x.com", "instagram.com",
  "youtube.com", "tiktok.com",
]);

const DISCOVERY_UA =
  "Mozilla/5.0 (compatible; Spotter/1.0; +https://sbotter.vercel.app)";
const DISCOVERY_VERIFY_TIMEOUT_MS = 5000;
const DISCOVERY_BATCH_LIMIT = 40;
// Strategy A hits each company's own domain once (distinct hosts, no shared
// rate limit), so a long delay just burns the function budget. A SERP-based
// Strategy B would hammer one service and must raise this back to >= 1000ms.
const DISCOVERY_DELAY_MS = 300;

function registrableDomain(host: string): string {
  return host.replace(/^www\./, "").toLowerCase().split(".").slice(-2).join(".");
}

// The domain of an email, but only if it looks like a company domain (not a free
// provider, job board, directory, or social site). Null otherwise.
function companyDomainFromEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const at = email.lastIndexOf("@");
  if (at === -1) return null;
  const reg = registrableDomain(email.slice(at + 1).trim());
  if (!reg || !reg.includes(".")) return null;
  if (GENERIC_EMAIL_PROVIDERS.has(reg)) return null;
  if (NON_COMPANY_DOMAINS.has(reg)) return null;
  return reg;
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
      // Server dislikes HEAD → let GET try; any other status is a real failure.
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
 * Discover a company's website. Never throws; returns an https:// URL or null.
 *
 * Strategy A (free, instant): derive the domain from a company email, skipping
 * free providers and job-board/directory/social domains, and confirm it
 * resolves with a quick HEAD/GET. Covers the majority of companies.
 *
 * Strategy B (search fallback): intentionally a no-op today. Every simple-fetch
 * SERP source tried (Google, Krak.dk, DuckDuckGo) is bot-blocked or JS-gated, so
 * it would only ever return null. To enable it, call a real SERP provider here
 * (Apify Google Search actor, Serper.dev, …), then run each result through
 * registrableDomain → NON_COMPANY_DOMAINS filter → domainResolves. companyName
 * is kept in the signature for exactly that.
 */
export async function discoverCompanyWebsite(
  companyName: string,
  cvrEmail: string | null,
): Promise<string | null> {
  try {
    // Strategy A — email domain.
    const domain = companyDomainFromEmail(cvrEmail);
    if (domain && (await domainResolves(domain))) {
      return `https://${domain}`;
    }

    // Strategy B — SERP fallback (disabled; see docblock).
    void companyName;
    return null;
  } catch (err) {
    console.warn(
      `[discover] failed for "${companyName}":`,
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

// If a company has no website on file, try to discover one from its email and,
// when found, store it and re-queue it for scraping. Skips the DB read when
// there's no email to work from (Strategy B is a no-op today). Never throws.
async function discoverWebsiteIfMissing(
  companyId: string,
  companyName: string,
  email: string | null,
): Promise<void> {
  if (!email) return; // nothing for Strategy A to use, and B is disabled
  const supabase = createSupabaseServiceClient();
  const { data } = await supabase
    .from("companies")
    .select("website")
    .eq("id", companyId)
    .single();
  if (data?.website) return;
  const website = await discoverCompanyWebsite(companyName, email);
  if (website) {
    await supabase
      .from("companies")
      .update({ website, website_scrape_status: "pending" })
      .eq("id", companyId);
    console.log(`[discover] ${companyName} (${companyId}) → ${website}`);
  }
}

export type EnrichResult = {
  status: CvrEnrichmentStatus;
  quotaExceeded: boolean;
};

/**
 * Enrich a single company row from CVR. Prefers exact CVR lookup, falls back to
 * name search. Writes results + status to the companies table. Never throws —
 * on transient failure it marks the row 'failed' (retryable); on a genuine miss
 * it marks 'no_match'. Returns the final status and whether the API quota was
 * hit (so batch callers can stop early).
 *
 * On success, also tries to discover a website from the CVR email if the row
 * doesn't have one. Pass { discoverWebsite: false } to skip this — the batch
 * does, because it runs a dedicated, bounded discovery pass instead.
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

      // Discover a website from the CVR email if we don't have one — the website
      // scraper depends on it. Skipped in batch (the discovery pass handles it).
      if (options.discoverWebsite !== false) {
        await discoverWebsiteIfMissing(companyId, companyName, result.email);
      }

      return { status: "enriched", quotaExceeded: false };
    }

    // not_found / name-mismatch → no_match (definitive). Everything else
    // (quota, network, invalid) → failed (retryable).
    const status: CvrEnrichmentStatus =
      outcome === "not_found" ? "no_match" : "failed";
    await supabase
      .from("companies")
      .update({ cvr_enrichment_status: status })
      .eq("id", companyId);
    return { status, quotaExceeded: outcome === "quota" };
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
    return { status: "failed", quotaExceeded: false };
  }
}

// How many websites to scrape per batch run. Kept modest: each scrape can make
// up to 5 slow HTTP requests, and the cron/route budget is 300s (CVR runs first).
const WEBSITE_BATCH_LIMIT = 20;

/**
 * Fallback enrichment from the company's own website, used only when CVR has no
 * phone/email. Scrapes the homepage + a few contact/about subpages and stores
 * the best phone, email, and named contact in the website_* columns — it never
 * overwrites CVR data (the UI falls back to these only when the CVR field is
 * null). Never throws: marks the row 'no_website' when there's nothing to
 * scrape, 'failed' on any error or empty result, and 'scraped' on success.
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

export type BatchEnrichSummary = {
  processed: number;
  enriched: number;
  failed: number;
  skipped: number;
  remaining: number;
  stoppedOnQuota: boolean;
  // Pass 2: website discovery for enriched companies that have no website yet.
  discovery: {
    processed: number;
    discovered: number;
    remaining: number;
  };
  // Pass 3: website scraping for companies still missing a phone after CVR.
  website: {
    processed: number;
    scraped: number;
    failed: number;
    noWebsite: number;
    remaining: number;
  };
};

/**
 * Enrich a batch of companies that are still 'pending' or 'failed' (oldest
 * first). Used by the manual batch endpoint and the cron job. Sleeps 1s between
 * calls to respect the rate limit, and stops early if the daily quota is hit.
 * Batch size: 40 without a token, 200 with CVRAPI_TOKEN (no quota).
 *
 * Then two more passes (the cron job inherits both automatically):
 *  - Pass 2: discover a website for enriched companies that have none, from
 *    their email domain (up to DISCOVERY_BATCH_LIMIT).
 *  - Pass 3: for companies that finished CVR but still have no phone and do have
 *    a website, scrape the website as a fallback (up to WEBSITE_BATCH_LIMIT).
 */
export async function enrichPendingCompanies(): Promise<BatchEnrichSummary> {
  const supabase = createSupabaseServiceClient();
  const limit = env.cvrApiToken ? 200 : 40;

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
  const total = companies?.length ?? 0;

  for (let i = 0; i < total; i++) {
    const c = companies![i];
    const { status, quotaExceeded } = await enrichCompanyFromCvr(
      c.id,
      c.cvr,
      c.name,
      { discoverWebsite: false },
    );
    if (status === "enriched") enriched++;
    else if (status === "no_match") skipped++;
    else failed++;

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

  // --- Pass 2: discover a website for enriched companies that have none -------
  // Pass 3 (scraping) needs a website, and most leads arrive without one. Cheap
  // email-domain discovery backfills them; bounded so the pass fits the budget,
  // the rest drain over subsequent runs. A discovered site is re-queued for
  // scraping (status → 'pending') so Pass 3 can pick it up this same run.
  const { data: needsDiscovery } = await supabase
    .from("companies")
    .select("id, name, email, website_email")
    .is("website", null)
    .eq("cvr_enrichment_status", "enriched")
    .or("email.not.is.null,website_email.not.is.null")
    .order("created_at", { ascending: true })
    .limit(DISCOVERY_BATCH_LIMIT);

  const discList = needsDiscovery ?? [];
  let discovered = 0;
  for (let i = 0; i < discList.length; i++) {
    const c = discList[i];
    const website = await discoverCompanyWebsite(c.name, c.email ?? c.website_email);
    if (website) {
      await supabase
        .from("companies")
        .update({ website, website_scrape_status: "pending" })
        .eq("id", c.id);
      discovered++;
      console.log(
        `[discover] batch ${i + 1}/${discList.length} — ${c.name} → ${website}`,
      );
    }
    if (i < discList.length - 1) await sleep(DISCOVERY_DELAY_MS);
  }

  const { count: discRemaining } = await supabase
    .from("companies")
    .select("id", { count: "exact", head: true })
    .is("website", null)
    .eq("cvr_enrichment_status", "enriched")
    .or("email.not.is.null,website_email.not.is.null");

  // --- Pass 3: website scraping fallback --------------------------------------
  // Companies that already got a phone from CVR never need a scrape — retire them
  // from the queue so the pending index stays small.
  await supabase
    .from("companies")
    .update({ website_scrape_status: "skipped" })
    .eq("website_scrape_status", "pending")
    .not("phone", "is", null);

  // Scrape companies that have finished CVR (so CVR had its chance), still have
  // no phone, and do have a website to visit. Oldest first.
  const terminalCvr: CvrEnrichmentStatus[] = ["enriched", "no_match", "failed"];
  const { data: needsWebsite } = await supabase
    .from("companies")
    .select("id, website")
    .is("phone", null)
    .not("website", "is", null)
    .eq("website_scrape_status", "pending")
    .in("cvr_enrichment_status", terminalCvr)
    .order("created_at", { ascending: true })
    .limit(WEBSITE_BATCH_LIMIT);

  const webList = needsWebsite ?? [];
  let webScraped = 0;
  let webFailed = 0;
  let webNoWebsite = 0;

  for (let i = 0; i < webList.length; i++) {
    const company = webList[i];
    const { status } = await enrichCompanyFromWebsite(company.id, company.website);
    if (status === "scraped") webScraped++;
    else if (status === "no_website") webNoWebsite++;
    else webFailed++;

    console.log(
      `[website] batch ${i + 1}/${webList.length} — ${company.id} → ${status}`,
    );
    // Websites are slower and more sensitive than the CVR API — be gentler.
    if (i < webList.length - 1) await sleep(1500);
  }

  const { count: webRemaining } = await supabase
    .from("companies")
    .select("id", { count: "exact", head: true })
    .is("phone", null)
    .not("website", "is", null)
    .eq("website_scrape_status", "pending")
    .in("cvr_enrichment_status", terminalCvr);

  const summary: BatchEnrichSummary = {
    processed: total,
    enriched,
    failed,
    skipped,
    remaining: remaining ?? 0,
    stoppedOnQuota,
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
  };
  console.log("[cvr] batch summary:", JSON.stringify(summary));
  return summary;
}
