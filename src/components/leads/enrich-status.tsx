"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { CvrEnrichmentStatus } from "@/types/database";

// Shows the CVR-enrichment state for a company: a subtle spinner while pending,
// or a retry button for failed / no-match rows. Renders nothing once enriched.
export function EnrichStatus({
  companyId,
  status,
}: {
  companyId: string;
  status: CvrEnrichmentStatus;
}) {
  const t = useTranslations("Leads.enrich");
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);

  if (status === "enriched" || status === "skipped") return null;

  if (status === "pending" && !busy) {
    return (
      <span className="text-muted-foreground inline-flex items-center gap-1 text-xs">
        <Loader2 className="size-3 animate-spin" />
        {t("pending")}
      </span>
    );
  }

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

  const label = status === "no_match" ? t("noMatch") : t("failed");
  const working = busy || isPending;

  return (
    <span className="inline-flex items-center gap-1 text-xs">
      <span className="text-muted-foreground">{label}</span>
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
