import { getTranslations, setRequestLocale } from "next-intl/server";
import { FilterPanel } from "@/components/leads/filter-panel";
import { CompaniesTable } from "@/components/leads/companies-table";
import { EmptyState } from "@/components/leads/empty-state";
import { Pagination } from "@/components/leads/pagination";
import { ResultsToolbar } from "@/components/leads/results-toolbar";
import { parseFiltersFromSearchParams } from "@/lib/leads/filters";
import {
  fetchActiveDataSources,
  fetchCompanies,
  fetchDistinctCities,
  fetchEnrichmentProgress,
  fetchLatestJobPostingAt,
} from "@/lib/leads/queries";
import { formatRelativeDate, isDataStale } from "@/lib/format";

type SearchParams = Record<string, string | string[] | undefined>;

export default async function CompaniesPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const [{ locale }, sp] = await Promise.all([params, searchParams]);
  setRequestLocale(locale);
  const filters = parseFiltersFromSearchParams(sp);
  const t = await getTranslations("Leads");

  const [page, cities, sources, latestJobAt, enrichment] = await Promise.all([
    fetchCompanies(filters),
    fetchDistinctCities(),
    fetchActiveDataSources(),
    fetchLatestJobPostingAt(),
    fetchEnrichmentProgress(),
  ]);

  // Formatted here rather than in the client toolbar: a relative time computed
  // on both sides of hydration would mismatch.
  const freshness = {
    label: latestJobAt ? formatRelativeDate(latestJobAt, locale) : null,
    stale: isDataStale(latestJobAt),
  };

  return (
    <div className="grid grid-cols-1 gap-6 md:grid-cols-[18rem_1fr]">
      <FilterPanel view="companies" cities={cities} sources={sources} />
      <div className="space-y-4">
        {page.rows.length === 0 ? (
          <EmptyState title={t("emptyTitle")} body={t("emptyBody")} />
        ) : (
          <>
            <ResultsToolbar
              total={page.total}
              freshness={freshness}
              enrichment={enrichment}
            />
            <CompaniesTable page={page} />
            {filters.perPage !== "all" ? (
              <Pagination
                page={page.page}
                total={page.total}
                pageSize={page.pageSize}
              />
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
