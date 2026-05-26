"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Phone, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

type StartResult = {
  started: number;
};

export function FindPhonesButton() {
  const t = useTranslations("Leads.krak");
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [, startTransition] = useTransition();

  async function run() {
    setRunning(true);
    try {
      const res = await fetch("/api/companies/krak-enrich", { method: "POST" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const s = (await res.json()) as StartResult;
      if (s.started === 0) {
        toast.info(t("findPhonesNone"));
      } else {
        toast.success(t("findPhonesStarted", { started: s.started }));
        startTransition(() => router.refresh());
      }
    } catch {
      toast.error(t("findPhonesError"));
    } finally {
      setRunning(false);
    }
  }

  return (
    <Button variant="outline" size="sm" onClick={run} disabled={running}>
      {running ? (
        <Loader2 className="size-4 animate-spin" />
      ) : (
        <Phone className="size-4" />
      )}
      <span className="ml-2">
        {running ? t("findPhonesRunning") : t("findPhones")}
      </span>
    </Button>
  );
}
