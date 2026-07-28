import { redirect } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { EmptyState } from "@/components/leads/empty-state";
import { LeadBoard } from "@/components/leads/lead-board";
import { RefreshListButton } from "@/components/leads/refresh-list-button";
import { todayInCopenhagen } from "@/lib/leads/daily-list-core";
import { fetchBoardLeads } from "@/lib/leads/queries";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export default async function TodayPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Leads.today");

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const leads = await fetchBoardLeads(user.id);
  // Resolved server-side so the "new today" badge can't disagree with the
  // browser's timezone across a hydration boundary.
  const todayISO = todayInCopenhagen();

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-muted-foreground text-sm">
          {t("count", { count: leads.length })}
        </p>
        <RefreshListButton />
      </div>

      {leads.length === 0 ? (
        <EmptyState title={t("emptyTitle")} body={t("emptyBody")} />
      ) : (
        <LeadBoard leads={leads} todayISO={todayISO} />
      )}
    </div>
  );
}
