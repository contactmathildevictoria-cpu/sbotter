import { formatDistanceToNowStrict } from "date-fns";
import { da, enUS } from "date-fns/locale";

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
