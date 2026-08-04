import { getTranslations, setRequestLocale } from "next-intl/server";
import { LeadTabs } from "@/components/leads/lead-tabs";
import { EnrichAllButton } from "@/components/leads/enrich-all-button";

export default async function LeadsLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Leads");

  return (
    <div className="container mx-auto max-w-6xl space-y-6 px-6 py-8">
      <header className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
          <p className="text-muted-foreground text-sm">{t("subtitle")}</p>
        </div>
        <div className="flex items-center gap-2">
          <EnrichAllButton />
        </div>
      </header>
      <LeadTabs />
      {children}
    </div>
  );
}
