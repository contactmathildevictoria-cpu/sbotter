/**
 * Danish phone number matching and normalization.
 *
 * PURE — no `server-only`, no I/O. Extracted from website-scraper.ts so the AI
 * phone layer validates candidates against the exact same rules as the
 * scraper: one definition of "a plausible Danish number", used by both.
 * Behaviour is unchanged from the scraper's original private copies.
 */

// Danish 8-digit phone numbers, optionally prefixed with +45. Lookarounds keep
// us from matching a slice of a longer digit run (e.g. an account number).
// NOTE: a /g regex is stateful under .test()/.exec() — use .matchAll(), or
// reset .lastIndex, if you reuse this one.
export const PHONE_RE = /(?<!\d)(?:\+45[\s.-]?)?(?:\d{2}[\s.-]?){3}\d{2}(?!\d)/g;

/** Normalize to a bare 8-digit key + a grouped display form, or null if not a
 *  plausible Danish number. Only strips a leading 45 when it's clearly a country
 *  code (explicit +45/0045, or a 10-digit number starting with 45). */
export function normalizePhone(
  raw: string,
): { key: string; display: string } | null {
  const cleaned = raw.replace(/[^\d+]/g, "");
  let digits: string;
  if (cleaned.startsWith("+45")) digits = cleaned.slice(3);
  else if (cleaned.startsWith("0045")) digits = cleaned.slice(4);
  else if (cleaned.length === 10 && cleaned.startsWith("45")) digits = cleaned.slice(2);
  else digits = cleaned.replace(/^\+/, "");
  digits = digits.replace(/\D/g, "");
  if (digits.length !== 8) return null;
  if (/^(\d)\1{7}$/.test(digits)) return null; // 00000000, 11111111 — not a phone
  return { key: digits, display: digits.replace(/(\d{2})(?=\d)/g, "$1 ") };
}
