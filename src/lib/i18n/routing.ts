import { defineRouting } from "next-intl/routing";

export const routing = defineRouting({
  locales: ["da", "en"],
  defaultLocale: "da",
  localePrefix: "as-needed",
});

export type AppLocale = (typeof routing.locales)[number];
