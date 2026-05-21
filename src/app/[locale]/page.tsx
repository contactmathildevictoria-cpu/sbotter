import { getTranslations, setRequestLocale } from "next-intl/server";
import { Button } from "@/components/ui/button";
import { Link } from "@/lib/i18n/navigation";

export default async function LandingPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Landing");
  const tBrand = await getTranslations("Brand");

  return (
    <main className="flex min-h-svh flex-1 flex-col">
      <header className="container mx-auto flex items-center justify-between px-6 py-6">
        <span className="text-lg font-semibold tracking-tight">
          {tBrand("name")}
        </span>
        <Button variant="ghost" asChild>
          <Link href="/login">{t("ctaLogin")}</Link>
        </Button>
      </header>
      <section className="container mx-auto flex flex-1 flex-col items-center justify-center gap-6 px-6 py-24 text-center">
        <h1 className="max-w-3xl text-4xl font-semibold tracking-tight sm:text-5xl">
          {t("headline")}
        </h1>
        <p className="text-muted-foreground max-w-2xl text-lg">
          {t("subheadline")}
        </p>
        <div className="flex gap-3">
          <Button asChild size="lg">
            <Link href="/signup">{t("ctaSignup")}</Link>
          </Button>
          <Button asChild size="lg" variant="outline">
            <Link href="/login">{t("ctaLogin")}</Link>
          </Button>
        </div>
      </section>
    </main>
  );
}
