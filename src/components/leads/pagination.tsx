"use client";

import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Link, usePathname } from "@/lib/i18n/navigation";

export function Pagination({
  page,
  total,
  pageSize,
}: {
  page: number;
  total: number;
  pageSize: number;
}) {
  const t = useTranslations("Leads.pagination");
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const lastPage = Math.max(1, Math.ceil(total / pageSize));
  const hasPrev = page > 1;
  const hasNext = page < lastPage;

  function hrefFor(targetPage: number) {
    const params = new URLSearchParams(searchParams.toString());
    if (targetPage <= 1) params.delete("page");
    else params.set("page", String(targetPage));
    const s = params.toString();
    return `${pathname}${s ? `?${s}` : ""}`;
  }

  if (total === 0) return null;

  return (
    <div className="text-muted-foreground flex items-center justify-between text-sm">
      <span>{t("page", { page })}</span>
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="sm"
          disabled={!hasPrev}
          asChild={hasPrev}
        >
          {hasPrev ? (
            <Link href={hrefFor(page - 1)}>
              <ArrowLeft className="mr-1 size-4" />
              {t("prev")}
            </Link>
          ) : (
            <span>
              <ArrowLeft className="mr-1 size-4" />
              {t("prev")}
            </span>
          )}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={!hasNext}
          asChild={hasNext}
        >
          {hasNext ? (
            <Link href={hrefFor(page + 1)}>
              {t("next")}
              <ArrowRight className="ml-1 size-4" />
            </Link>
          ) : (
            <span>
              {t("next")}
              <ArrowRight className="ml-1 size-4" />
            </span>
          )}
        </Button>
      </div>
    </div>
  );
}
