"use client";

import { useTransition } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { usePathname, useRouter } from "@/lib/i18n/navigation";
import { PER_PAGE_OPTIONS } from "@/lib/leads/filters";

/**
 * Pipeline freshness, formatted on the server so the relative time can't drift
 * between render and hydration.
 */
export type DataFreshness = {
  /** Already-localised relative time, e.g. "3 hours ago". Null = never ingested. */
  label: string | null;
  /** Nothing has landed for over 48h — the pipeline is probably dead. */
  stale: boolean;
};

// Top-of-results toolbar: total count, how fresh the data is, a page-size picker
// (25/50/100/All), and a CSV export of every matching company (respects the
// current filters).
export function ResultsToolbar({
  total,
  freshness,
}: {
  total: number;
  freshness: DataFreshness;
}) {
  const t = useTranslations("Leads.toolbar");
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const currentPerPage = searchParams.get("per_page") ?? "25";
  // The export route reads the same filter params; page/per_page are ignored
  // there (it always exports all matching rows).
  const exportHref = `/api/companies/export?${searchParams.toString()}`;

  function onPerPageChange(value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value === "25") params.delete("per_page");
    else params.set("per_page", value);
    params.delete("page"); // back to the first page when the size changes
    const s = params.toString();
    startTransition(() => router.replace(`${pathname}${s ? `?${s}` : ""}`));
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="text-muted-foreground text-sm tabular-nums">
          {t("count", { count: total })}
        </span>
        {/* The two-second health check: if this is red, the pipeline is dead. */}
        <span
          className={`text-sm ${
            freshness.stale
              ? "text-destructive font-medium"
              : "text-muted-foreground"
          }`}
          title={freshness.stale ? t("updatedStaleHint") : undefined}
        >
          {freshness.label
            ? t("updated", { time: freshness.label })
            : t("updatedNever")}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <Select
          value={currentPerPage}
          onValueChange={onPerPageChange}
          disabled={isPending}
        >
          <SelectTrigger className="h-9 w-[8rem]" aria-label={t("pageSize")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PER_PAGE_OPTIONS.map((opt) => (
              <SelectItem key={String(opt)} value={String(opt)}>
                {opt === "all" ? t("perPageAll") : t("perPageN", { n: opt })}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button variant="outline" size="sm" asChild>
          <a href={exportHref} download>
            <Download className="size-4" />
            <span className="ml-2">{t("export")}</span>
          </a>
        </Button>
      </div>
    </div>
  );
}
