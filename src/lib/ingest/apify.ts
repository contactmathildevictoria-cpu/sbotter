import "server-only";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { env } from "@/lib/env";
import {
  normalizeJobnetItem,
  type NormalizedCompany,
  type NormalizedJob,
} from "@/lib/ingest/normalize";

export type IngestResult = {
  itemsReceived: number;
  companiesUpserted: number;
  jobsUpserted: number;
  jobsDeactivated: number;
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

export async function processJobnetItems(
  rawItems: unknown[],
  ctx: { apifyRunId?: string; apifyActorId?: string } = {},
): Promise<IngestResult> {
  const supabase = createSupabaseServiceClient();

  // 1) Open a scrape_run row.
  const { data: runRow, error: runError } = await supabase
    .from("scrape_runs")
    .insert({
      source_id: "jobnet",
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
        normalized.push(normalizeJobnetItem(raw));
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
    let companiesUpserted = 0;
    const now = new Date().toISOString();

    for (const company of companyByKey.values()) {
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
        .select("id, slug")
        .single();
      if (error) {
        throw new Error(
          `Company upsert failed for "${company.name}": ${error.message}`,
        );
      }
      companyIdBySlug.set(data.slug, data.id);
      companiesUpserted += 1;
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

    // 5) Mark postings absent from this run as inactive — only when the run
    //    yielded a non-trivial number of items, to avoid wiping the table on a
    //    partial / empty run.
    let jobsDeactivated = 0;
    if (seenExternalIds.size > 0) {
      const idsList = Array.from(seenExternalIds)
        .map((id) => `"${id.replace(/"/g, "")}"`)
        .join(",");
      const { data, error } = await supabase
        .from("job_postings")
        .update({ is_active: false })
        .eq("source_id", "jobnet")
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
