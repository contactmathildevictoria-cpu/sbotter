import { getTranslations, setRequestLocale } from "next-intl/server";
import { FilterPanel } from "@/components/leads/filter-panel";
import { JobsTable } from "@/components/leads/jobs-table";
import { EmptyState } from "@/components/leads/empty-state";
import { Pagination } from "@/components/leads/pagination";
import { parseFiltersFromSearchParams } from "@/lib/leads/filters";
import {
  fetchActiveDataSources,
  fetchDistinctCities,
  fetchJobs,
} from "@/lib/leads/queries";

type SearchParams = Record<string, string | string[] | undefined>;

export default async function JobsPage({
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

  const [page, cities, sources] = await Promise.all([
    fetchJobs(filters),
    fetchDistinctCities(),
    fetchActiveDataSources(),
  ]);

  return (
    <div className="grid grid-cols-1 gap-6 md:grid-cols-[18rem_1fr]">
      <FilterPanel view="jobs" cities={cities} sources={sources} />
      <div className="space-y-4">
        {page.rows.length === 0 ? (
          <EmptyState title={t("emptyTitle")} body={t("emptyBody")} />
        ) : (
          <>
            <JobsTable page={page} />
            <Pagination
              page={page.page}
              total={page.total}
              pageSize={page.pageSize}
            />
          </>
        )}
      </div>
    </div>
  );
}
