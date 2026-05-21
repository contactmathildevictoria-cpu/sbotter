import { LogOut } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Button } from "@/components/ui/button";
import { signOutAction } from "@/lib/auth/actions";

export async function SignOutButton() {
  const t = await getTranslations("Nav");

  return (
    <form action={signOutAction}>
      <Button variant="ghost" size="sm" type="submit">
        <LogOut className="size-4" />
        <span className="ml-2">{t("signOut")}</span>
      </Button>
    </form>
  );
}
