import { getTranslations, setRequestLocale } from "next-intl/server";
import { LeadTabs } from "@/components/leads/lead-tabs";

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
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="text-muted-foreground text-sm">{t("subtitle")}</p>
      </header>
      <LeadTabs />
      {children}
    </div>
  );
}
