// Shared, dependency-free helpers used by every Sbotter Actor. Plain ESM so they
// compile under each Actor's tsconfig with no extra deps. Source of truth lives
// here; `npm run sync:shared` copies this dir into each <actor>/src/shared/.

/** Strip HTML tags + common entities, collapse whitespace, cap at 8000 chars. */
export function stripHtml(html: string | null | undefined): string | null {
  if (!html) return null;
  const text = html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
  return text.length ? text.slice(0, 8000) : null;
}

const DA_MONTHS: Record<string, number> = {
  januar: 0, jan: 0,
  februar: 1, feb: 1,
  marts: 2, mar: 2,
  april: 3, apr: 3,
  maj: 4,
  juni: 5, jun: 5,
  juli: 6, jul: 6,
  august: 7, aug: 7,
  september: 8, sep: 8, sept: 8,
  oktober: 9, okt: 9, oct: 9,
  november: 10, nov: 10,
  december: 11, dec: 11,
};

function isoOrNull(d: Date): string | null {
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * Parse a date string into an ISO timestamp (or null). Handles, in order:
 *  - ISO / RFC strings (passthrough via Date)
 *  - Danish absolute dates: "18. maj 2026", "18 maj 2026"
 *  - Relative dates (da + en): "i dag"/"today", "i går"/"yesterday",
 *    "for 3 dage siden"/"3 dage siden"/"3 days ago"/"30+ days ago",
 *    "for 5 timer siden"/"5 hours ago".
 * Relative dates are computed against `now` (default: current time).
 */
export function normalizeDate(
  raw: string | null | undefined,
  now: Date = new Date(),
): string | null {
  if (!raw) return null;
  const s = raw.trim();
  if (!s) return null;

  // 1) ISO-ish — let Date handle it directly.
  if (/^\d{4}-\d{2}-\d{2}([T ]|$)/.test(s)) {
    const iso = isoOrNull(new Date(s));
    if (iso) return iso;
  }

  const lower = s.toLowerCase();

  // 2) Relative keywords.
  if (lower === "i dag" || lower === "today" || lower.includes("just posted")) {
    return now.toISOString();
  }
  if (lower === "i går" || lower === "igår" || lower === "yesterday") {
    return new Date(now.getTime() - 86_400_000).toISOString();
  }

  // 3) Relative N-units (da + en). "30+ days ago" → treat as 30.
  const rel = lower.match(
    /(\d+)\s*\+?\s*(time|timer|hour|hours|dag|dage|day|days|uge|uger|week|weeks|måned|måneder|month|months)/,
  );
  if (rel) {
    const n = parseInt(rel[1], 10);
    const unit = rel[2];
    const ms =
      unit.startsWith("time") || unit.startsWith("hour")
        ? n * 3_600_000
        : unit.startsWith("uge") || unit.startsWith("week")
          ? n * 7 * 86_400_000
          : unit.startsWith("måned") || unit.startsWith("month")
            ? n * 30 * 86_400_000
            : n * 86_400_000; // dag/dage/day/days
    return new Date(now.getTime() - ms).toISOString();
  }

  // 4) Danish absolute: "18. maj 2026" / "18 maj 2026".
  const abs = lower.match(/(\d{1,2})\.?\s+([a-zæøå]+)\.?\s+(\d{4})/);
  if (abs) {
    const day = parseInt(abs[1], 10);
    const month = DA_MONTHS[abs[2]];
    const year = parseInt(abs[3], 10);
    if (month !== undefined) {
      return isoOrNull(new Date(Date.UTC(year, month, day)));
    }
  }

  // 5) Last resort: let Date try (handles many en-US formats).
  return isoOrNull(new Date(s));
}

/**
 * Clean a Danish phone number to bare 8 digits, or null. Drops a +45 / 0045 / 45
 * country prefix and any separators. Returns null unless exactly 8 digits remain.
 */
export function normalizeDanishPhone(
  raw: string | null | undefined,
): string | null {
  if (!raw) return null;
  let digits = raw.replace(/[^\d+]/g, "");
  if (digits.startsWith("+45")) digits = digits.slice(3);
  else if (digits.startsWith("0045")) digits = digits.slice(4);
  digits = digits.replace(/\D/g, "");
  if (digits.length === 10 && digits.startsWith("45")) digits = digits.slice(2);
  return digits.length === 8 ? digits : null;
}
