"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Sparkles, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

type BatchSummary = {
  enriched: number;
  failed: number;
  skipped: number;
  remaining: number;
  discovery?: { processed: number; discovered: number };
  website?: { processed: number; scraped: number };
};

export function EnrichAllButton() {
  const t = useTranslations("Leads.enrich");
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [, startTransition] = useTransition();

  async function run() {
    setRunning(true);
    try {
      const res = await fetch("/api/companies/enrich-batch", { method: "POST" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const s = (await res.json()) as BatchSummary;
      toast.success(
        t("enrichAllDone", {
          enriched: s.enriched,
          failed: s.failed,
          remaining: s.remaining,
        }),
      );
      if (s.discovery && s.discovery.discovered > 0) {
        toast.success(
          t("enrichAllDiscovered", { discovered: s.discovery.discovered }),
        );
      }
      if (s.website && s.website.processed > 0) {
        toast.success(t("enrichAllWebsite", { scraped: s.website.scraped }));
      }
      startTransition(() => router.refresh());
    } catch {
      toast.error(t("enrichAllError"));
    } finally {
      setRunning(false);
    }
  }

  return (
    <Button variant="outline" size="sm" onClick={run} disabled={running}>
      {running ? (
        <Loader2 className="size-4 animate-spin" />
      ) : (
        <Sparkles className="size-4" />
      )}
      <span className="ml-2">
        {running ? t("enrichAllRunning") : t("enrichAll")}
      </span>
    </Button>
  );
}
