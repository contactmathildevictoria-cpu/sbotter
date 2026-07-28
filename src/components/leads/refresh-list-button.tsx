"use client";

import { useTransition } from "react";
import { useTranslations } from "next-intl";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "@/lib/i18n/navigation";
import { Button } from "@/components/ui/button";
import { refreshMyList } from "@/lib/leads/crm-actions";

/**
 * Runs the daily-list engine on demand. Without this the board would only
 * ever fill at the 06:00 cron. Safe to press repeatedly: the engine plans
 * nothing once the board already holds daily_target unworked leads.
 */
export function RefreshListButton() {
  const t = useTranslations("Leads.today");
  const tErrors = useTranslations("Leads.errors");
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function handleClick() {
    startTransition(async () => {
      const result = await refreshMyList();
      if (!result.ok) {
        toast.error(tErrors(result.error));
        return;
      }
      const summary = result.data;
      if (!summary || summary.total === 0) {
        toast.info(t("refreshNone"));
      } else {
        toast.success(
          t("refreshDone", {
            fresh: summary.fresh,
            recycled: summary.recycled + summary.fill,
          }),
        );
      }
      router.refresh();
    });
  }

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={handleClick}
      disabled={isPending}
    >
      <RefreshCw className={isPending ? "animate-spin" : undefined} />
      {isPending ? t("refreshing") : t("refresh")}
    </Button>
  );
}
