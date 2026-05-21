"use client";

import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { Link, usePathname } from "@/lib/i18n/navigation";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "/leads/companies", key: "tabCompanies" },
  { href: "/leads/jobs", key: "tabJobs" },
] as const;

export function LeadTabs() {
  const t = useTranslations("Leads");
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const search = searchParams.toString();
  const suffix = search ? `?${search}` : "";

  return (
    <nav
      role="tablist"
      className="border-border/60 flex items-center gap-1 border-b"
    >
      {TABS.map(({ href, key }) => {
        const active = pathname === href;
        return (
          <Link
            key={href}
            href={`${href}${suffix}`}
            role="tab"
            aria-selected={active}
            className={cn(
              "relative px-4 py-2.5 text-sm font-medium transition-colors",
              active
                ? "text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t(key)}
            {active ? (
              <span className="bg-foreground absolute inset-x-0 -bottom-px h-0.5" />
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
