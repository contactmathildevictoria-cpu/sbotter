import "server-only";
import { parse, type HTMLElement } from "node-html-parser";
import { PHONE_RE, normalizePhone } from "@/lib/phone";

// Fallback contact enrichment: when a company's CVR record has no phone/email,
// we visit the company's own website and try to scrape contact info from the
// homepage and a few "Kontakt"/"Om os" subpages. This is best-effort and
// inherently less reliable than CVR — it never throws; on any failure (or no
// useful data) it returns null. Partial data is better than none.

export interface WebsiteContactResult {
  phones: string[];
  emails: string[];
  contactPersons: Array<{
    name: string;
    title: string | null; // 'CEO', 'Direktør', 'Ejer', 'Indehaver', etc.
    phone: string | null;
    email: string | null;
  }>;
  scrapedUrl: string;
}

// Identifies us politely and points at the app, per the spec.
const USER_AGENT =
  "Mozilla/5.0 (compatible; Spotter/1.0; +https://sbotter.vercel.app)";
const FETCH_TIMEOUT_MS = 10_000;
const MAX_SUBPAGES = 4;
const MAX_HTML_BYTES = 2_000_000; // ignore enormous pages — almost never useful

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
// Anchored, non-global twin of EMAIL_RE for validating a single candidate. (A
// /g regex is stateful under .test(), so it must not be reused that way.)
const EMAIL_VALIDATE_RE = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

// Local-parts that are never a real person/team contact — drop them entirely.
const EMAIL_BLOCKLIST = [
  "noreply",
  "no-reply",
  "webmaster",
  "hostmaster",
  "postmaster",
  "mailer-daemon",
  "abuse",
];
// Valid but generic mailboxes — kept, but ranked below personal addresses.
const EMAIL_GENERIC = [
  "info",
  "kontakt",
  "contact",
  "hello",
  "hej",
  "mail",
  "post",
  "salg",
  "sales",
  "support",
  "admin",
  "booking",
  "kundeservice",
  "firmapost",
  "office",
];

// Words near a number that suggest it's actually a phone number.
const PHONE_KEYWORDS = [
  "tlf",
  "telefon",
  "phone",
  "ring",
  "mobil",
  "cell",
  "tel.",
  "tel ",
  "direkte",
  "kontakt",
];

// Danish + English titles, longest-first so "Administrerende direktør" wins over
// "Direktør". Matched as whole words (Unicode-aware, so æøå count as letters).
const TITLES = [
  "Administrerende direktør",
  "Adm. direktør",
  "Adm direktør",
  "Bestyrelsesformand",
  "Afdelingsleder",
  "Daglig leder",
  "Kontorchef",
  "Salgschef",
  "Markedschef",
  "Co-founder",
  "Direktør",
  "Indehaver",
  "Chairman",
  "Founder",
  "Partner",
  "Stifter",
  "Manager",
  "Leder",
  "Ejer",
  "CEO",
  "CFO",
  "COO",
  "CTO",
];
const TITLE_MATCHERS = TITLES.map((title) => ({
  title,
  re: new RegExp(
    `(?<![\\p{L}])${title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}])`,
    "iu",
  ),
}));

// Pathname / link-text fragments that mark a contact or about/team subpage.
const SUBPAGE_URL_PATTERNS = [
  "/kontakt",
  "/contact",
  "/om-os",
  "/om",
  "/about-us",
  "/about",
  "/team",
  "/ledelse",
  "/management",
  "/bestyrelse",
  "/medarbejdere",
  "/staff",
];
const SUBPAGE_TEXT_PATTERNS = [
  "kontakt",
  "contact",
  "om os",
  "about",
  "team",
  "ledelse",
  "management",
];
// Highest-value subpages (contact pages) should be fetched first.
const CONTACT_URL_PATTERNS = ["/kontakt", "/contact"];

// Never fetch these — they aren't HTML.
const SKIP_EXTENSIONS = new Set([
  "pdf", "jpg", "jpeg", "png", "gif", "svg", "webp", "ico", "bmp", "tiff",
  "doc", "docx", "xls", "xlsx", "ppt", "pptx", "csv", "zip", "rar", "gz", "7z",
  "mp3", "mp4", "mov", "avi", "wmv", "css", "js", "json", "xml", "rss",
  "woff", "woff2", "ttf", "eot", "dmg", "exe", "apk",
]);

// A redirect to one of these paths means the page is login-gated — stop.
const LOGIN_PATH_RE =
  /\/(login|signin|log-in|sign-in|logind|log-ind|auth|wp-login|wp-admin|signup|sign-up)\b/i;

function clean(text: string | undefined | null): string {
  return (text ?? "").replace(/\s+/g, " ").trim();
}

function stripWww(host: string): string {
  return host.replace(/^www\./i, "").toLowerCase();
}

// Last two labels — good enough for .dk and most TLDs we'll see.
function baseDomain(host: string): string {
  const parts = stripWww(host).split(".");
  return parts.slice(-2).join(".");
}

// ---------------------------------------------------------------------------
// Phone / email normalization + classification
// ---------------------------------------------------------------------------

// PHONE_RE and normalizePhone now live in @/lib/phone (imported above) so the
// AI phone layer can reuse them — that module is pure, this one is server-only.

function emailLocalPart(email: string): string {
  return email.slice(0, email.indexOf("@")).toLowerCase();
}

function isBlockedEmail(email: string): boolean {
  const local = emailLocalPart(email);
  return EMAIL_BLOCKLIST.some((b) => local === b || local.startsWith(`${b}+`));
}

function isGenericEmail(email: string): boolean {
  return EMAIL_GENERIC.includes(emailLocalPart(email));
}

function matchTitle(text: string): string | null {
  for (const { title, re } of TITLE_MATCHERS) {
    if (re.test(text)) return title;
  }
  return null;
}

const NON_NAME_WORDS = [
  "kontakt", "cookie", "copyright", "rights", "privacy", "persondata",
  "læs mere", "read more", "menu", "nyheder", "newsletter", "tilmeld",
  "om os", "about", "produkter", "services", "ydelser",
];
const PERSON_NAME_RE =
  /^[A-ZÆØÅ][a-zæøåA-ZÆØÅ.'-]+(?:\s+[A-ZÆØÅ][a-zæøåA-ZÆØÅ.'-]+){1,3}$/;

/** A loose "looks like a 2–4 word capitalized human name" check. */
function isPersonName(text: string): boolean {
  const s = clean(text);
  if (s.length < 4 || s.length > 60) return false;
  if (/[\d@]/.test(s)) return false;
  if (!PERSON_NAME_RE.test(s)) return false;
  const lower = s.toLowerCase();
  if (NON_NAME_WORDS.some((w) => lower.includes(w))) return false;
  if (matchTitle(s)) return false; // a bare title is not a name
  return true;
}

// ---------------------------------------------------------------------------
// Fetching
// ---------------------------------------------------------------------------

type Page = { root: HTMLElement; finalUrl: string };

/** Fetch a URL as HTML with a hard timeout. Returns null on any non-HTML / non-OK
 *  response, a login redirect, or a network/timeout error. Never throws. */
async function fetchPage(url: string): Promise<Page | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      cache: "no-store",
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "da, en;q=0.8",
      },
    });
    if (!res.ok) return null;

    const finalUrl = res.url || url;
    if (LOGIN_PATH_RE.test(new URL(finalUrl).pathname)) return null;

    const contentType = res.headers.get("content-type") ?? "";
    if (!/text\/html|application\/xhtml/i.test(contentType)) return null;

    const html = await res.text();
    if (!html || html.length > MAX_HTML_BYTES) return null;

    return { root: parse(html), finalUrl };
  } catch (err) {
    console.warn(
      `[website] fetch failed for ${url}:`,
      err instanceof Error ? err.message : err,
    );
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// robots.txt (lightweight — honors Disallow for our UA or '*')
// ---------------------------------------------------------------------------

function parseRobots(txt: string): string[] {
  const groups: Array<{ agents: string[]; disallow: string[] }> = [];
  let current: { agents: string[]; disallow: string[] } | null = null;
  let lastWasAgent = false;

  for (const rawLine of txt.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) continue;
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const field = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();

    if (field === "user-agent") {
      if (!current || !lastWasAgent) {
        current = { agents: [], disallow: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
    } else if (field === "disallow" && current) {
      current.disallow.push(value);
      lastWasAgent = false;
    } else {
      lastWasAgent = false;
    }
  }

  const applicable =
    groups.find((g) => g.agents.some((a) => a.includes("spotter"))) ??
    groups.find((g) => g.agents.includes("*"));
  return applicable?.disallow ?? [];
}

/** Fetch + parse robots.txt. Missing/unreadable robots.txt means "allow all". */
async function fetchRobots(origin: string): Promise<string[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(`${origin}/robots.txt`, {
      signal: controller.signal,
      cache: "no-store",
      headers: { "User-Agent": USER_AGENT },
    });
    if (!res.ok) return [];
    return parseRobots(await res.text());
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

function robotsAllows(disallow: string[], path: string): boolean {
  for (const rule of disallow) {
    if (rule === "") continue; // empty Disallow = allow everything
    const hasEnd = rule.endsWith("$");
    const body = hasEnd ? rule.slice(0, -1) : rule;
    const escaped = body
      .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
      .replace(/\*/g, ".*");
    if (new RegExp(`^${escaped}${hasEnd ? "$" : ""}`).test(path)) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Extraction
// ---------------------------------------------------------------------------

type PageKind = "homepage" | "contact" | "subpage";

type PhoneCand = {
  key: string;
  display: string;
  page: PageKind;
  tel: boolean; // from a tel: link
  keyword: boolean; // near a phone keyword (or on a contact page)
  footer: boolean;
};
type EmailCand = {
  value: string;
  page: PageKind;
  mailto: boolean;
  generic: boolean;
  sameDomain: boolean;
};

function inFooter(el: HTMLElement): boolean {
  return el.closest('footer, [class*="footer"], [id*="footer"]') != null;
}

function collectPhones(
  root: HTMLElement,
  page: PageKind,
  out: PhoneCand[],
): void {
  // tel: links are the most reliable signal.
  for (const a of root.querySelectorAll('a[href^="tel:"]')) {
    const href = a.getAttribute("href") ?? "";
    const norm = normalizePhone(decodeURIComponent(href.slice("tel:".length)));
    if (norm) {
      out.push({ ...norm, page, tel: true, keyword: true, footer: inFooter(a) });
    }
  }
  // Free-text matches, scored by proximity to a phone keyword. structuredText
  // (not .text) keeps separators between elements, so adjacent numbers/words
  // don't glue together (which would defeat both the keyword window and the
  // (?<!\d) guard).
  const text = root.structuredText;
  for (const m of text.matchAll(PHONE_RE)) {
    const norm = normalizePhone(m[0]);
    if (!norm) continue;
    const idx = m.index ?? 0;
    const before = text.slice(Math.max(0, idx - 30), idx).toLowerCase();
    const keyword =
      page === "contact" || PHONE_KEYWORDS.some((k) => before.includes(k));
    out.push({ ...norm, page, tel: false, keyword, footer: false });
  }
}

function collectEmails(
  root: HTMLElement,
  page: PageKind,
  siteHost: string,
  out: EmailCand[],
): void {
  const base = baseDomain(siteHost);
  const push = (raw: string, mailto: boolean) => {
    const value = raw.trim().toLowerCase().replace(/[.,;:)]+$/, "");
    if (!EMAIL_VALIDATE_RE.test(value)) return;
    if (isBlockedEmail(value)) return;
    const emailDomain = value.slice(value.indexOf("@") + 1);
    out.push({
      value,
      page,
      mailto,
      generic: isGenericEmail(value),
      sameDomain: baseDomain(emailDomain) === base,
    });
  };
  for (const a of root.querySelectorAll('a[href^="mailto:"]')) {
    const href = a.getAttribute("href") ?? "";
    const addr = decodeURIComponent(href.slice("mailto:".length)).split("?")[0];
    if (addr) push(addr, true);
  }
  for (const m of root.structuredText.matchAll(EMAIL_RE)) push(m[0], false);
}

type Person = WebsiteContactResult["contactPersons"][number];

/** Extract named contacts: Schema.org Person markup first, then heading/strong
 *  elements that look like a name with a title nearby in the same block. */
function collectPersons(root: HTMLElement, out: Person[]): void {
  // A) Schema.org microdata.
  for (const nameEl of root.querySelectorAll('[itemprop="name"]')) {
    const name = clean(nameEl.text);
    if (!isPersonName(name)) continue;
    const scope = nameEl.closest("[itemscope]") ?? nameEl.parentNode;
    const title =
      clean(scope?.querySelector('[itemprop="jobTitle"]')?.text) ||
      matchTitle(clean(scope?.structuredText)) ||
      null;
    const tel = scope?.querySelector('[itemprop="telephone"]')?.text;
    const mail = scope?.querySelector('[itemprop="email"]')?.text;
    out.push({
      name,
      title,
      phone: tel ? (normalizePhone(tel)?.display ?? null) : null,
      email: mail ? clean(mail).toLowerCase() || null : null,
    });
  }

  // B) Heading/strong that looks like a name, with a title in its card/row.
  const blockSel =
    "li, tr, article, .card, .team-member, .employee, .person, .member, .col, .vcard";
  for (const el of root.querySelectorAll("h2, h3, h4, h5, strong, b")) {
    const name = clean(el.text);
    if (!isPersonName(name)) continue;
    const block = el.closest(blockSel) ?? el.parentNode;
    if (!block) continue;
    // structuredText keeps a separator between the name and the title element.
    const blockText = clean(block.structuredText);
    const title = matchTitle(blockText);
    if (!title) continue; // require an explicit title to treat as a contact
    const tel = block.querySelector('a[href^="tel:"]')?.getAttribute("href");
    const mail = block.querySelector('a[href^="mailto:"]')?.getAttribute("href");
    out.push({
      name,
      title,
      phone: tel
        ? (normalizePhone(decodeURIComponent(tel.slice(4)))?.display ?? null)
        : null,
      email: mail
        ? decodeURIComponent(mail.slice(7)).split("?")[0].toLowerCase() || null
        : null,
    });
  }
}

// ---------------------------------------------------------------------------
// Ranking
// ---------------------------------------------------------------------------

function phoneScore(c: PhoneCand): number {
  let s = 0;
  if (c.tel) s += 100;
  if (c.page === "contact") s += 50;
  else if (c.page === "subpage") s += 20;
  if (c.keyword) s += 30;
  if (c.footer) s += 10;
  return s;
}

/** Rank phones best-first and drop zero-signal free-text matches (likely dates,
 *  CVR numbers, etc.). Keeps only numbers with a tel: link, keyword proximity,
 *  footer placement, or a contact-page context. */
function rankPhones(cands: PhoneCand[]): string[] {
  const best = new Map<string, { display: string; score: number }>();
  for (const c of cands) {
    const score = phoneScore(c);
    if (score <= 0) continue; // no positive signal → too risky to keep
    const prev = best.get(c.key);
    if (!prev || score > prev.score) best.set(c.key, { display: c.display, score });
  }
  return [...best.values()]
    .sort((a, b) => b.score - a.score)
    .map((v) => v.display);
}

function emailScore(c: EmailCand): number {
  let s = 0;
  if (!c.generic) s += 100; // personal address (jens@…) preferred
  if (c.sameDomain) s += 30;
  if (c.mailto) s += 20;
  if (c.page === "contact") s += 15;
  else if (c.page === "subpage") s += 5;
  return s;
}

function rankEmails(cands: EmailCand[]): string[] {
  const best = new Map<string, number>();
  for (const c of cands) {
    const score = emailScore(c);
    const prev = best.get(c.value);
    if (prev === undefined || score > prev) best.set(c.value, score);
  }
  return [...best.entries()].sort((a, b) => b[1] - a[1]).map(([v]) => v);
}

function dedupePersons(persons: Person[]): Person[] {
  const byName = new Map<string, Person>();
  for (const p of persons) {
    const key = p.name.toLowerCase();
    const prev = byName.get(key);
    if (!prev) {
      byName.set(key, p);
      continue;
    }
    // Merge: keep the richest record for this name.
    byName.set(key, {
      name: p.name,
      title: prev.title ?? p.title,
      phone: prev.phone ?? p.phone,
      email: prev.email ?? p.email,
    });
  }
  // People with a title (and ideally contact details) first.
  return [...byName.values()].sort((a, b) => personRank(b) - personRank(a));
}

function personRank(p: Person): number {
  return (p.title ? 2 : 0) + (p.phone || p.email ? 1 : 0);
}

// ---------------------------------------------------------------------------
// Subpage discovery
// ---------------------------------------------------------------------------

function hasSkipExtension(pathname: string): boolean {
  const dot = pathname.lastIndexOf(".");
  if (dot === -1) return false;
  const ext = pathname.slice(dot + 1).toLowerCase();
  return SKIP_EXTENSIONS.has(ext);
}

function subpageScore(pathname: string, linkText: string): number {
  let s = 0;
  if (CONTACT_URL_PATTERNS.some((p) => pathname.includes(p))) s += 100;
  else if (SUBPAGE_URL_PATTERNS.some((p) => pathname.includes(p))) s += 50;
  if (SUBPAGE_TEXT_PATTERNS.some((p) => linkText.includes(p))) s += 25;
  return s;
}

/** Same-domain contact/about/team links, ranked so contact pages come first. */
function findSubpageLinks(
  root: HTMLElement,
  baseUrl: string,
  disallow: string[],
): string[] {
  const base = new URL(baseUrl);
  const homePath = base.origin + base.pathname;
  const scored = new Map<string, number>();

  for (const a of root.querySelectorAll("a")) {
    const href = a.getAttribute("href");
    if (!href) continue;
    let u: URL;
    try {
      u = new URL(href, base);
    } catch {
      continue;
    }
    if (u.protocol !== "http:" && u.protocol !== "https:") continue;
    if (stripWww(u.hostname) !== stripWww(base.hostname)) continue; // same domain only
    if (hasSkipExtension(u.pathname)) continue;
    if (!robotsAllows(disallow, u.pathname)) continue;

    const normalized = u.origin + u.pathname; // ignore query/hash for dedup
    if (normalized === homePath) continue;

    const score = subpageScore(
      u.pathname.toLowerCase(),
      clean(a.text).toLowerCase(),
    );
    if (score <= 0) continue;
    const prev = scored.get(normalized) ?? 0;
    if (score > prev) scored.set(normalized, score);
  }

  return [...scored.entries()].sort((a, b) => b[1] - a[1]).map(([u]) => u);
}

function isContactUrl(url: string): boolean {
  try {
    const p = new URL(url).pathname.toLowerCase();
    return CONTACT_URL_PATTERNS.some((c) => p.includes(c));
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

/** URL variants to try, https first then http. Accepts input with or without a
 *  scheme and tolerates a leading "www." or stray slashes. */
function urlCandidates(websiteUrl: string): string[] {
  const noScheme = websiteUrl
    .trim()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//i, "")
    .replace(/^\/+/, "");
  if (!noScheme) return [];
  return [`https://${noScheme}`, `http://${noScheme}`];
}

/**
 * Scrape contact info from a company website. Fetches the homepage (https, then
 * http), respects robots.txt, then follows up to 4 same-domain contact/about
 * subpages. Returns ranked phones/emails + any named contacts found, or null if
 * the site is unreachable, blocked, or yields nothing useful. Never throws.
 */
export async function scrapeWebsiteContacts(
  websiteUrl: string,
): Promise<WebsiteContactResult | null> {
  try {
    if (!websiteUrl || !websiteUrl.trim()) return null;

    // 1) Homepage (try https, then http).
    let home: Page | null = null;
    for (const candidate of urlCandidates(websiteUrl)) {
      home = await fetchPage(candidate);
      if (home) break;
    }
    if (!home) return null;

    const homeUrl = new URL(home.finalUrl);
    const origin = homeUrl.origin;
    const siteHost = homeUrl.hostname;

    // 2) robots.txt — if the homepage path is disallowed, respect it and stop.
    const disallow = await fetchRobots(origin);
    if (!robotsAllows(disallow, homeUrl.pathname)) {
      console.warn(`[website] robots.txt disallows ${origin}; skipping`);
      return null;
    }

    const phoneCands: PhoneCand[] = [];
    const emailCands: EmailCand[] = [];
    const persons: Person[] = [];

    collectPhones(home.root, "homepage", phoneCands);
    collectEmails(home.root, "homepage", siteHost, emailCands);
    collectPersons(home.root, persons);

    // 3) Up to MAX_SUBPAGES contact/about subpages (contact pages first).
    const subpages = findSubpageLinks(home.root, home.finalUrl, disallow).slice(
      0,
      MAX_SUBPAGES,
    );
    for (const sub of subpages) {
      const page = await fetchPage(sub);
      if (!page) continue; // skip and continue with the others
      const kind: PageKind = isContactUrl(sub) ? "contact" : "subpage";
      collectPhones(page.root, kind, phoneCands);
      collectEmails(page.root, kind, siteHost, emailCands);
      collectPersons(page.root, persons);
    }

    // 4) Fold any phone/email attached to a named contact into the pools — they
    //    carry strong signal (explicitly tied to a person).
    for (const p of persons) {
      if (p.phone) {
        const norm = normalizePhone(p.phone);
        if (norm)
          phoneCands.push({
            ...norm,
            page: "contact",
            tel: true,
            keyword: true,
            footer: false,
          });
      }
      if (p.email && !isBlockedEmail(p.email)) {
        emailCands.push({
          value: p.email,
          page: "contact",
          mailto: true,
          generic: isGenericEmail(p.email),
          sameDomain: baseDomain(p.email.slice(p.email.indexOf("@") + 1)) ===
            baseDomain(siteHost),
        });
      }
    }

    const phones = rankPhones(phoneCands);
    const emails = rankEmails(emailCands);
    const contactPersons = dedupePersons(persons);

    if (phones.length === 0 && emails.length === 0 && contactPersons.length === 0) {
      return null; // nothing useful
    }

    return { phones, emails, contactPersons, scrapedUrl: home.finalUrl };
  } catch (err) {
    console.warn(
      `[website] scrape failed for ${websiteUrl}:`,
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}
