"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Checkbox } from "@/components/ui/checkbox";
import { usePathname, useRouter } from "@/lib/i18n/navigation";
import {
  CATEGORIES,
  COUNTRIES,
  DEFAULT_FILTERS,
  filtersToSearchString,
  parseFiltersFromSearchParams,
  type LeadFilters,
  type SinceKey,
} from "@/lib/leads/filters";

const SINCE_KEYS: SinceKey[] = ["24h", "7d", "30d", "any"];

type FilterPanelProps = {
  view: "companies" | "jobs";
  cities: string[];
  sources: { id: string; name: string }[];
};

export function FilterPanel({ view, cities, sources }: FilterPanelProps) {
  const t = useTranslations("Leads.filters");
  const tCat = useTranslations("Leads.categories");
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  // URL is the source of truth for the committed filter set.
  const filters = useMemo<LeadFilters>(
    () =>
      parseFiltersFromSearchParams(Object.fromEntries(searchParams.entries())),
    [searchParams],
  );

  // Pending values: text-search (debounced) and slider (committed on release).
  const [searchDraft, setSearchDraft] = useState(filters.q);
  const [minJobsDraft, setMinJobsDraft] = useState(filters.minOpenJobs);
  const [lastUrlQ, setLastUrlQ] = useState(filters.q);
  const [lastUrlMinJobs, setLastUrlMinJobs] = useState(filters.minOpenJobs);

  // Re-sync drafts when the URL changes externally (tab switch, reset).
  // React 19: in-render setState beats useEffect for state derived from props.
  if (filters.q !== lastUrlQ) {
    setLastUrlQ(filters.q);
    setSearchDraft(filters.q);
  }
  if (filters.minOpenJobs !== lastUrlMinJobs) {
    setLastUrlMinJobs(filters.minOpenJobs);
    setMinJobsDraft(filters.minOpenJobs);
  }

  function applyFilters(next: LeadFilters) {
    const search = filtersToSearchString({ ...next, page: 1 });
    startTransition(() => {
      router.replace(`${pathname}${search}`);
    });
  }

  // Debounce the text-search input.
  useEffect(() => {
    if (searchDraft === filters.q) return;
    const handle = setTimeout(() => {
      applyFilters({ ...filters, q: searchDraft });
    }, 300);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchDraft]);

  function reset() {
    setSearchDraft("");
    setMinJobsDraft(1);
    applyFilters(DEFAULT_FILTERS);
  }

  return (
    <aside
      aria-label={t("title")}
      className="bg-card sticky top-4 w-full max-w-xs space-y-5 self-start rounded-xl border p-5 text-sm"
    >
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold">{t("title")}</h2>
        <Button
          variant="ghost"
          size="sm"
          onClick={reset}
          disabled={isPending}
          className="text-muted-foreground"
        >
          <X className="mr-1 size-3.5" />
          {t("reset")}
        </Button>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="filter-search">{t("search")}</Label>
        <div className="relative">
          <Search className="text-muted-foreground absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
          <Input
            id="filter-search"
            value={searchDraft}
            onChange={(e) => setSearchDraft(e.target.value)}
            placeholder={t("search")}
            className="pl-8"
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label>{t("city")}</Label>
        <Select
          value={filters.city ?? "__any__"}
          onValueChange={(v) =>
            applyFilters({ ...filters, city: v === "__any__" ? null : v })
          }
        >
          <SelectTrigger>
            <SelectValue placeholder={t("anyCity")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__any__">{t("anyCity")}</SelectItem>
            {cities.map((c) => (
              <SelectItem key={c} value={c}>
                {c}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <Label>{t("country")}</Label>
        <Select
          value={filters.country ?? "__any__"}
          onValueChange={(v) =>
            applyFilters({ ...filters, country: v === "__any__" ? null : v })
          }
        >
          <SelectTrigger>
            <SelectValue placeholder={t("anyCountry")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__any__">{t("anyCountry")}</SelectItem>
            {COUNTRIES.map((c) => (
              <SelectItem key={c} value={c}>
                {c}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <Label>{t("category")}</Label>
        <Select
          value={filters.category ?? "__any__"}
          onValueChange={(v) =>
            applyFilters({ ...filters, category: v === "__any__" ? null : v })
          }
        >
          <SelectTrigger>
            <SelectValue placeholder={t("anyCategory")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__any__">{t("anyCategory")}</SelectItem>
            {CATEGORIES.map((c) => (
              <SelectItem key={c} value={c}>
                {tCat(c)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <Label>{t("since")}</Label>
        <Select
          value={filters.since}
          onValueChange={(v) =>
            applyFilters({ ...filters, since: v as SinceKey })
          }
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SINCE_KEYS.map((k) => (
              <SelectItem key={k} value={k}>
                {t(`since${k === "any" ? "Any" : k.toUpperCase()}` as never)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {view === "companies" ? (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label>{t("minOpenJobs")}</Label>
            <span className="text-muted-foreground tabular-nums">
              {minJobsDraft}
            </span>
          </div>
          <Slider
            min={1}
            max={10}
            step={1}
            value={[minJobsDraft]}
            onValueChange={([v]) => setMinJobsDraft(v ?? 1)}
            onValueCommit={([v]) =>
              applyFilters({ ...filters, minOpenJobs: v ?? 1 })
            }
          />
        </div>
      ) : null}

      {sources.length > 0 ? (
        <div className="space-y-2">
          <Label>{t("source")}</Label>
          <div className="space-y-1.5">
            {sources.map((source) => {
              const checked = filters.sources.includes(source.id);
              return (
                <label
                  key={source.id}
                  className="flex cursor-pointer items-center gap-2 text-sm"
                >
                  <Checkbox
                    checked={checked}
                    onCheckedChange={(value) => {
                      const next = value
                        ? [...filters.sources, source.id]
                        : filters.sources.filter((id) => id !== source.id);
                      applyFilters({ ...filters, sources: next });
                    }}
                  />
                  <span>{source.name}</span>
                </label>
              );
            })}
          </div>
        </div>
      ) : null}
    </aside>
  );
}
