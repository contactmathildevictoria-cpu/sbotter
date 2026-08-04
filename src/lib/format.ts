import { formatDistanceToNowStrict } from "date-fns";
import { da, enUS } from "date-fns/locale";

/**
 * How long the ingest pipeline may go quiet before we call the data stale.
 *
 * Jobnet is scraped nightly, so a gap wider than two runs means something is
 * broken — an Actor that stopped, a webhook that stopped delivering — rather
 * than a slow day. The leads header turns red past this mark.
 */
export const DATA_STALE_AFTER_MS = 48 * 60 * 60 * 1000;

/** True when the newest ingested row is older than {@link DATA_STALE_AFTER_MS}. */
export function isDataStale(iso: string | null, now: number = Date.now()): boolean {
  if (!iso) return true; // nothing ingested at all is the worst case, not the best
  const at = new Date(iso).getTime();
  if (Number.isNaN(at)) return true;
  return now - at > DATA_STALE_AFTER_MS;
}

export function formatRelativeDate(
  iso: string,
  locale: string = "en",
): string {
  try {
    return formatDistanceToNowStrict(new Date(iso), {
      addSuffix: true,
      locale: locale === "da" ? da : enUS,
    });
  } catch {
    return iso;
  }
}
