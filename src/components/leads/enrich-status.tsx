"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type {
  CvrEnrichmentStatus,
  WebsiteScrapeStatus,
} from "@/types/database";

// Shows the enrichment state for a company that still has no contact details:
// a subtle spinner while CVR or the website scraper is working, otherwise a
// retry button. Rendered by CompaniesTable only when no contact was found.
// Retry re-runs CVR and then the website scraper (see the enrich route).
export function EnrichStatus({
  companyId,
  cvrStatus,
  websiteStatus,
}: {
  companyId: string;
  cvrStatus: CvrEnrichmentStatus;
  websiteStatus: WebsiteScrapeStatus;
}) {
  const t = useTranslations("Leads.enrich");
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);

  async function retry() {
    setBusy(true);
    try {
      const res = await fetch(`/api/companies/${companyId}/enrich`, {
        method: "POST",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      startTransition(() => router.refresh());
    } catch {
      toast.error(t("retryError"));
    } finally {
      setBusy(false);
    }
  }

  // CVR still running → CVR spinner.
  if (!busy && cvrStatus === "pending") {
    return <Pending label={t("pending")} />;
  }
  // CVR finished without a phone, website scrape still queued → website spinner.
  if (!busy && websiteStatus === "pending") {
    return <Pending label={t("websitePending")} />;
  }

  // Terminal: nothing found anywhere. Offer a retry.
  const working = busy || isPending;
  return (
    <span className="inline-flex items-center gap-1 text-xs">
      <span className="text-muted-foreground">{t("noContact")}</span>
      <Button
        variant="ghost"
        size="sm"
        className="h-6 px-1.5"
        onClick={retry}
        disabled={working}
        aria-label={t("retry")}
      >
        <RefreshCw className={`size-3 ${working ? "animate-spin" : ""}`} />
      </Button>
    </span>
  );
}

function Pending({ label }: { label: string }) {
  return (
    <span className="text-muted-foreground inline-flex items-center gap-1 text-xs">
      <Loader2 className="size-3 animate-spin" />
      {label}
    </span>
  );
}
