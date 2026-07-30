"use client";

import { useOptimistic, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { useRouter } from "@/lib/i18n/navigation";
import { Badge } from "@/components/ui/badge";
import { LeadCard } from "@/components/leads/lead-card";
import { deleteLead, setLeadStatus } from "@/lib/leads/crm-actions";
import type { BoardLead } from "@/lib/leads/queries";
import type { LeadStatus } from "@/types/database";

/**
 * The board shows every ACTIVE lead, not just today's. A conversation that
 * started yesterday must not vanish at midnight; today's arrivals are marked
 * with a badge on the card instead.
 */
const COLUMNS: { key: string; statuses: LeadStatus[] }[] = [
  { key: "new", statuses: ["new"] },
  { key: "contacted", statuses: ["contacted"] },
  { key: "no_pickup", statuses: ["no_pickup"] },
  { key: "meeting", statuses: ["meeting"] },
  { key: "closed", statuses: ["won", "lost"] },
];

export function LeadBoard({
  leads,
  todayISO,
}: {
  leads: BoardLead[];
  todayISO: string;
}) {
  const t = useTranslations("Leads.board");
  const tErrors = useTranslations("Leads.errors");
  const tDelete = useTranslations("Leads.delete");
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  // useOptimistic rather than useState seeded from props: after
  // router.refresh() the server sends fresh props, and optimistic state
  // rebases onto them automatically instead of going stale.
  type Change =
    | { type: "status"; id: string; status: LeadStatus }
    | { type: "delete"; id: string };

  const [optimisticLeads, applyOptimistic] = useOptimistic(
    leads,
    (current: BoardLead[], change: Change) =>
      change.type === "delete"
        ? current.filter((lead) => lead.id !== change.id)
        : current.map((lead) =>
            lead.id === change.id ? { ...lead, status: change.status } : lead,
          ),
  );

  function handleStatusChange(id: string, status: LeadStatus) {
    startTransition(async () => {
      applyOptimistic({ type: "status", id, status });
      const result = await setLeadStatus({ id, status });
      if (!result.ok) {
        toast.error(tErrors(result.error));
      }
      // Reconcile: a no_pickup also sets in_trash + follow_up_at server-side,
      // which the optimistic update can't know.
      router.refresh();
    });
  }

  function handleDelete(id: string) {
    startTransition(async () => {
      applyOptimistic({ type: "delete", id });
      const result = await deleteLead({ id });
      if (result.ok) {
        toast.success(tDelete("done"));
      } else {
        toast.error(tErrors(result.error));
      }
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-4 overflow-x-auto pb-2 md:flex-row">
      {COLUMNS.map(({ key, statuses }) => {
        const columnLeads = optimisticLeads.filter((lead) =>
          statuses.includes(lead.status),
        );
        return (
          <section
            key={key}
            aria-label={t(key)}
            className="flex w-full shrink-0 flex-col gap-3 md:w-80"
          >
            <header className="flex items-center justify-between gap-2 px-0.5">
              <h2 className="text-sm font-medium">{t(key)}</h2>
              <Badge variant="secondary" className="tabular-nums">
                {columnLeads.length}
              </Badge>
            </header>
            <div className="space-y-3">
              {columnLeads.map((lead) => (
                <LeadCard
                  key={lead.id}
                  lead={lead}
                  todayISO={todayISO}
                  onStatusChange={handleStatusChange}
                  onDelete={handleDelete}
                  pending={isPending}
                />
              ))}
              {columnLeads.length === 0 ? (
                <p className="text-muted-foreground rounded-xl border border-dashed px-3 py-6 text-center text-xs">
                  {t("emptyColumn")}
                </p>
              ) : null}
            </div>
          </section>
        );
      })}
    </div>
  );
}
