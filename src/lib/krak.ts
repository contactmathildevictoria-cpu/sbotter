import "server-only";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { env } from "@/lib/env";

// Max companies sent to a single Krak Actor run. Krak is scraped with a real
// browser and a 2s pause between companies, so runs are deliberately small.
export const KRAK_BATCH_LIMIT = 100;

/** The shape of each company sent to the Krak Actor as input. */
export type KrakCompanyInput = {
  id: string;
  name: string;
  city: string | null;
};

/**
 * One per-company lookup result posted back by the Actor. `matched` is the
 * Actor's conservative judgement that the Krak listing is really this company;
 * we only trust phone/contact data when it's true.
 */
export type KrakResult = {
  companyId: string;
  matched: boolean;
  phone: string | null;
  contactPerson: string | null;
  contactTitle: string | null;
  krakUrl: string | null;
};

/**
 * Companies still worth a Krak lookup: those with no phone yet (CVR didn't find
 * one) that we haven't already sent to Krak. Oldest first, capped at the batch
 * limit. The 'pending' guard (vs. 'queued'/terminal) stops a second click from
 * re-enqueueing in-flight or already-tried rows.
 */
export async function collectCompaniesForKrak(): Promise<KrakCompanyInput[]> {
  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase
    .from("companies")
    .select("id, name, location_city")
    .is("phone", null)
    .eq("krak_enrichment_status", "pending")
    .order("created_at", { ascending: true })
    .limit(KRAK_BATCH_LIMIT);

  if (error) {
    throw new Error(`Failed to load companies for Krak lookup: ${error.message}`);
  }

  return (data ?? []).map((c) => ({
    id: c.id,
    name: c.name,
    city: c.location_city,
  }));
}

/**
 * Start a Krak enricher Actor run on Apify for the given companies. Flips the
 * rows to 'queued' first (so they aren't re-enqueued), then fires the run and
 * returns immediately — results arrive minutes later via /api/ingest/krak.
 * Throws a typed error if APIFY_TOKEN or KRAK_ENRICHER_ACTOR_ID is missing.
 */
export async function startKrakEnrichmentRun(
  companies: KrakCompanyInput[],
): Promise<{ started: number; runId: string }> {
  if (companies.length === 0) {
    throw new Error("startKrakEnrichmentRun called with no companies");
  }

  const actorId = env.krakEnricherActorId;
  if (!actorId) {
    throw new Error(
      "KRAK_ENRICHER_ACTOR_ID is not set — cannot start a Krak enrichment run.",
    );
  }
  // Throws with a clear message if APIFY_TOKEN is missing.
  const token = env.apifyTokenRequired;

  const supabase = createSupabaseServiceClient();
  const ids = companies.map((c) => c.id);
  const { error: queueError } = await supabase
    .from("companies")
    .update({ krak_enrichment_status: "queued" })
    .in("id", ids);
  if (queueError) {
    throw new Error(`Failed to queue companies for Krak: ${queueError.message}`);
  }

  // The run input. The Actor reads the webhook URL/secret input-first, then falls
  // back to its SBOTTER_WEBHOOK_URL / SBOTTER_WEBHOOK_SECRET env vars. The secret
  // is the same shared APIFY_WEBHOOK_SECRET the receiver verifies against.
  const input = {
    mode: "scrape" as const,
    companies,
    maxItems: companies.length,
    webhookUrl: `${env.appUrl}/api/ingest/krak`,
    webhookSecret: env.apifyWebhookSecret,
  };

  const runUrl = `https://api.apify.com/v2/acts/${encodeURIComponent(actorId)}/runs?token=${token}`;
  const res = await fetch(runUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
    cache: "no-store",
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    // Roll the rows back to 'pending' so the next click can retry them.
    await supabase
      .from("companies")
      .update({ krak_enrichment_status: "pending" })
      .in("id", ids);
    throw new Error(`Apify run start failed (HTTP ${res.status}): ${detail}`);
  }

  const json = (await res.json()) as { data?: { id?: string } };
  return { started: companies.length, runId: json.data?.id ?? "" };
}

/**
 * Apply Krak results to companies. FILL-EMPTY-ONLY: writes the dedicated krak_*
 * columns (provenance) and the krak status; NEVER touches the canonical phone /
 * contact_person_name / any CVR column. The leads UI falls back to krak_* when
 * the CVR field is null. Double-guards on `matched` so an unmatched listing can
 * never store a phone. Returns counts. Never throws on a single bad row.
 */
export async function applyKrakResults(
  items: KrakResult[],
): Promise<{ enriched: number; noMatch: number; failed: number }> {
  const supabase = createSupabaseServiceClient();
  const now = new Date().toISOString();
  let enriched = 0;
  let noMatch = 0;
  let failed = 0;

  for (const item of items) {
    if (!item.companyId) {
      failed++;
      continue;
    }

    const matchedWithPhone = item.matched && Boolean(item.phone);
    const update = matchedWithPhone
      ? {
          krak_phone: item.phone,
          krak_contact_person: item.contactPerson ?? null,
          krak_contact_title: item.contactTitle ?? null,
          krak_url: item.krakUrl ?? null,
          krak_enriched_at: now,
          krak_enrichment_status: "enriched" as const,
        }
      : {
          krak_enriched_at: now,
          krak_enrichment_status: "no_match" as const,
        };

    const { error } = await supabase
      .from("companies")
      .update(update)
      .eq("id", item.companyId);

    if (error) {
      console.error(`[krak] failed to update company ${item.companyId}:`, error);
      failed++;
    } else if (matchedWithPhone) {
      enriched++;
    } else {
      noMatch++;
    }
  }

  console.log(
    `[krak] applied ${items.length} results — enriched ${enriched}, no_match ${noMatch}, failed ${failed}`,
  );
  return { enriched, noMatch, failed };
}
