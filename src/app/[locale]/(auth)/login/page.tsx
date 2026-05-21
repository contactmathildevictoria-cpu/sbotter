import { Suspense } from "react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { LoginForm } from "@/components/auth/login-form";

export default async function LoginPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Auth");
  const tBrand = await getTranslations("Brand");

  return (
    <div className="bg-card rounded-xl border p-8 shadow-sm">
      <div className="mb-6 space-y-1">
        <p className="text-muted-foreground text-xs font-medium tracking-wider uppercase">
          {tBrand("name")}
        </p>
        <h1 className="text-2xl font-semibold">{t("loginTitle")}</h1>
        <p className="text-muted-foreground text-sm">{t("loginSubtitle")}</p>
      </div>
      <Suspense>
        <LoginForm />
      </Suspense>
    </div>
  );
}
