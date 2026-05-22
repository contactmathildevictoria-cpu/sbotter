import { getTranslations } from "next-intl/server";
import { Button } from "@/components/ui/button";
import { Link } from "@/lib/i18n/navigation";

// Rendered inside [locale]/layout (which provides <html>/<body>) whenever a
// localized path matches no route.
export default async function LocaleNotFound() {
  const t = await getTranslations("NotFound");

  return (
    <main className="flex min-h-svh flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
      <p className="text-muted-foreground text-sm font-medium tracking-wider uppercase">
        404
      </p>
      <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
      <p className="text-muted-foreground max-w-md">{t("body")}</p>
      <Button asChild>
        <Link href="/leads">{t("cta")}</Link>
      </Button>
    </main>
  );
}
