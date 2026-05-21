import { redirect } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { signOutAction } from "@/lib/auth/actions";
import { PLAN_LABELS, type PlanTier } from "@/lib/plans";

export default async function SettingsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Settings");

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("email, full_name, plan")
    .eq("id", user.id)
    .single();

  const plan: PlanTier = profile?.plan ?? "free";

  return (
    <div className="container mx-auto max-w-2xl space-y-6 px-6 py-8">
      <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>

      <section className="bg-card space-y-4 rounded-xl border p-6">
        <h2 className="text-base font-semibold">{t("profile")}</h2>
        <div className="text-sm">
          <div className="text-muted-foreground">{t("email")}</div>
          <div className="font-medium">{profile?.email ?? user.email}</div>
        </div>
      </section>

      <section className="bg-card space-y-4 rounded-xl border p-6">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold">{t("plan")}</h2>
          <Badge variant="secondary">{PLAN_LABELS[plan]}</Badge>
        </div>
        <Separator />
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">{t("upgradeComingSoon")}</span>
          <Button disabled>{t("upgrade")}</Button>
        </div>
      </section>

      <form action={signOutAction}>
        <Button type="submit" variant="outline">
          {t("signOut")}
        </Button>
      </form>
    </div>
  );
}
