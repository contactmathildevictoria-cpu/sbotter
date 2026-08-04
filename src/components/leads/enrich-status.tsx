"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type {
  CvrEnrichmentStatus,
  KrakEnrichmentStatus,
} from "@/types/database";

const Dash = () => <span className="text-muted-foreground">—</span>;

/**
 * The contact-column affordance for a company we have no contact data for.
 *
 * A spinner here means "a job is running right now", and nothing else. It used
 * to be shown for `cvr_enrichment_status === "pending"`, which is not a
 * running job — it is "never attempted", the state most rows sit in forever.
 * That is what made "Henter data…" appear on every empty row and never
 * resolve. `queued` on the Krak pass is the only genuine in-flight state in
 * the schema: an Apify run has been started and results are on their way back.
 *
 * Everything else renders an em dash, except failed / no-match CVR rows, which
 * keep their label and retry button — those are outcomes, not loading states.
 */
export function EnrichStatus({
  companyId,
  status,
  krakStatus,
}: {
  companyId: string;
  status: CvrEnrichmentStatus;
  krakStatus: KrakEnrichmentStatus;
}) {
  const t = useTranslations("Leads.enrich");
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);

  if (krakStatus === "queued" && !busy) {
    return (
      <span className="text-muted-foreground inline-flex items-center gap-1 text-xs">
        <Loader2 className="size-3 animate-spin" />
        {t("running")}
      </span>
    );
  }

  // Not attempted yet, or attempted and simply came up empty.
  if (status !== "failed" && status !== "no_match" && !busy) return <Dash />;

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
