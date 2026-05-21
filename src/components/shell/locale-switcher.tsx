"use client";

import { Languages } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { usePathname, useRouter } from "@/lib/i18n/navigation";
import { routing } from "@/lib/i18n/routing";

const LABELS: Record<(typeof routing.locales)[number], string> = {
  da: "Dansk",
  en: "English",
};

export function LocaleSwitcher() {
  const t = useTranslations("Nav");
  const router = useRouter();
  const pathname = usePathname();
  const currentLocale = useLocale();

  function onSelect(locale: (typeof routing.locales)[number]) {
    if (locale === currentLocale) return;
    router.replace(pathname, { locale });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" aria-label={t("language")}>
          <Languages className="size-4" />
          <span className="ml-2 uppercase">{currentLocale}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {routing.locales.map((locale) => (
          <DropdownMenuItem key={locale} onClick={() => onSelect(locale)}>
            {LABELS[locale]}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
