import "server-only";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { env } from "@/lib/env";
import {
  normalizeItem,
  type NormalizedCompany,
  type NormalizedJob,
  type SourceId,
} from "@/lib/ingest/normalize";

/** A company that still needs CVR enrichment (newly inserted or still pending). */
export type EnrichmentCandidate = {
  id: string;
  cvr: string | null;
  name: string;
};

export type IngestResult = {
  itemsReceived: number;
  companiesUpserted: number;
  jobsUpserted: number;
  jobsDeactivated: number;
  // Companies whose cvr_enrichment_status is still 'pending'. The caller fires
  // enrichment for these (fire-and-forget) so the webhook response isn't blocked.
  enrichmentCandidates: EnrichmentCandidate[];
};

export async function fetchApifyDatasetItems(
  datasetId: string,
): Promise<unknown[]> {
  if (!env.apifyToken) {
    throw new Error(
      "Cannot fetch Apify dataset: APIFY_TOKEN is not configured. " +
        "For local testing, embed `items` directly in the webhook payload.",
    );
  }
  const url = `https://api.apify.com/v2/datasets/${datasetId}/items?clean=true&format=json&token=${env.apifyToken}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`Apify dataset fetch failed: ${res.status} ${res.statusText}`);
  }
  return (await res.json()) as unknown[];
}

export async function processIngestItems(
  rawItems: unknown[],
  source: SourceId,
  ctx: { apifyRunId?: string; apifyActorId?: string } = {},
): Promise<IngestResult> {
  const supabase = createSupabaseServiceClient();

  // 1) Open a scrape_run row.
  const { data: runRow, error: runError } = await supabase
    .from("scrape_runs")
    .insert({
      source_id: source,
      apify_run_id: ctx.apifyRunId ?? null,
      apify_actor_id: ctx.apifyActorId ?? null,
      status: "running",
      items_received: rawItems.length,
    })
    .select("id")
    .single();

  if (runError || !runRow) {
    throw new Error(`Failed to open scrape_run: ${runError?.message ?? "unknown"}`);
  }

  const runId = runRow.id;
  const seenExternalIds = new Set<string>();

  try {
    // 2) Normalize.
    const normalized: NormalizedJob[] = [];
    for (const raw of rawItems) {
      try {
        normalized.push(normalizeItem(raw, source));
      } catch {
        // Skip malformed items — they'll show up as a delta against items_received.
      }
    }

    // 3) Upsert companies. Dedup by (cvr || domain || slug).
    const companyByKey = new Map<string, NormalizedCompany>();
    for (const job of normalized) {
      const key = job.company.cvr ?? job.company.domain ?? job.company.slug;
      const prev = companyByKey.get(key);
      if (!prev) {
        companyByKey.set(key, job.company);
      } else {
        // Merge: prefer non-null fields from either source.
        companyByKey.set(key, {
          ...prev,
          cvr: prev.cvr ?? job.company.cvr,
          website: prev.website ?? job.company.website,
          domain: prev.domain ?? job.company.domain,
          description: prev.description ?? job.company.description,
          locationCity: prev.locationCity ?? job.company.locationCity,
          locationRegion: prev.locationRegion ?? job.company.locationRegion,
          country: prev.country ?? job.company.country,
        });
      }
    }

    const companyIdBySlug = new Map<string, string>();
    const enrichmentCandidates: EnrichmentCandidate[] = [];
    let companiesUpserted = 0;
    const now = new Date().toISOString();

    for (const company of companyByKey.values()) {
      // Note: we deliberately don't set cvr_enrichment_status in the upsert, so
      // it defaults to 'pending' on insert and is left untouched on update.
      const { data, error } = await supabase
        .from("companies")
        .upsert(
          {
            name: company.name,
            slug: company.slug,
            cvr: company.cvr,
            website: company.website,
            domain: company.domain,
            description: company.description,
            location_city: company.locationCity,
            location_region: company.locationRegion,
            country: company.country,
            last_seen_at: now,
          },
          { onConflict: "slug" },
        )
        .select("id, slug, cvr, name, cvr_enrichment_status")
        .single();
      if (error) {
        throw new Error(
          `Company upsert failed for "${company.name}": ${error.message}`,
        );
      }
      companyIdBySlug.set(data.slug, data.id);
      companiesUpserted += 1;

      // Enrich anything not yet enriched (new rows default to 'pending'; existing
      // 'enriched' rows are skipped). Failed/no_match rows are left for manual retry.
      if (data.cvr_enrichment_status === "pending") {
        enrichmentCandidates.push({ id: data.id, cvr: data.cvr, name: data.name });
      }
    }

    // 4) Upsert job postings.
    let jobsUpserted = 0;
    for (const job of normalized) {
      const companyId = companyIdBySlug.get(job.company.slug);
      if (!companyId) continue;
      const { error } = await supabase.from("job_postings").upsert(
        {
          company_id: companyId,
          source_id: job.sourceId,
          external_id: job.externalId,
          title: job.title,
          description: job.description,
          category: job.category,
          url: job.url,
          posted_at: job.postedAt,
          expires_at: job.expiresAt,
          location_city: job.locationCity,
          location_region: job.locationRegion,
          country: job.country,
          is_active: true,
          raw: job.raw as never,
        },
        { onConflict: "source_id,external_id" },
      );
      if (error) {
        throw new Error(
          `Job upsert failed for ${job.externalId}: ${error.message}`,
        );
      }
      seenExternalIds.add(job.externalId);
      jobsUpserted += 1;
    }

    // 5) Mark postings absent from this run as inactive — only for THIS source,
    //    and only when the run yielded a non-trivial number of items, to avoid
    //    wiping the table on a partial / empty run. Scoping to `source` is
    //    critical: an Indeed run must never deactivate Jobnet's postings.
    let jobsDeactivated = 0;
    if (seenExternalIds.size > 0) {
      const idsList = Array.from(seenExternalIds)
        .map((id) => `"${id.replace(/"/g, "")}"`)
        .join(",");
      const { data, error } = await supabase
        .from("job_postings")
        .update({ is_active: false })
        .eq("source_id", source)
        .eq("is_active", true)
        .not("external_id", "in", `(${idsList})`)
        .select("id");
      if (!error && Array.isArray(data)) {
        jobsDeactivated = data.length;
      }
    }

    // 6) Close the scrape_run.
    await supabase
      .from("scrape_runs")
      .update({
        status: "succeeded",
        companies_upserted: companiesUpserted,
        jobs_upserted: jobsUpserted,
        finished_at: new Date().toISOString(),
      })
      .eq("id", runId);

    return {
      itemsReceived: rawItems.length,
      companiesUpserted,
      jobsUpserted,
      jobsDeactivated,
      enrichmentCandidates,
    };
  } catch (err) {
    await supabase
      .from("scrape_runs")
      .update({
        status: "failed",
        finished_at: new Date().toISOString(),
        error: { message: err instanceof Error ? err.message : String(err) },
      })
      .eq("id", runId);
    throw err;
  }
}
