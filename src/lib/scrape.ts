import "server-only";
import { env } from "@/lib/env";

/**
 * Starting scheduled scrape runs on Apify.
 *
 * POST to the Actor's /runs endpoint and return immediately. The Actor scrapes
 * for minutes afterwards and POSTs its dataset to /api/ingest/apify itself,
 * signed with the shared APIFY_WEBHOOK_SECRET — so the ingest path is already
 * in place and unchanged.
 *
 * This never throws. It backs a cron, and a missing token or Actor id is a
 * not-yet-configured deployment, not a failure worth alerting on.
 */

/**
 * How many ads to pull per daily run.
 *
 * Jobnet carries ~23k live ads, but a daily run only needs what's new. Sorting
 * by PublicationDate (rather than the Actor's BestMatch default) puts the newest
 * first, so a few hundred covers a day's postings comfortably. Ingest marks
 * postings absent from a run as inactive, and re-running is idempotent —
 * companies dedupe on cvr/domain/slug and postings on (source_id, external_id).
 */
const DAILY_MAX_ITEMS = 500;

export type ScrapeRunResult =
  | { ok: true; runId: string; actorId: string; maxItems: number }
  | { ok: false; reason: "no_actor_id" | "no_token" | "start_failed"; detail?: string };

/**
 * Kicks off a Jobnet scrape run.
 *
 * Returns a result rather than throwing so the cron can report a clean no-op
 * when the Actor hasn't been deployed yet.
 */
export async function startJobnetScrapeRun(): Promise<ScrapeRunResult> {
  const actorId = env.jobnetActorId;
  if (!actorId) {
    console.log("[scrape] jobnet skipped — JOBNET_ACTOR_ID not configured");
    return { ok: false, reason: "no_actor_id" };
  }

  const token = env.apifyToken;
  if (!token) {
    console.log("[scrape] jobnet skipped — APIFY_TOKEN not configured");
    return { ok: false, reason: "no_token" };
  }

  // Webhook URL and secret go in the input, not the Actor's env vars, so the
  // secret lives only in Vercel and can be rotated without reconfiguring the
  // Actor. The Actor reads input first and falls back to its env vars.
  const input = {
    mode: "scrape" as const,
    searchString: "",
    maxItems: DAILY_MAX_ITEMS,
    orderType: "PublicationDate" as const,
    webhookUrl: `${env.appUrl}/api/ingest/apify`,
    webhookSecret: env.apifyWebhookSecret,
  };

  const runUrl = `https://api.apify.com/v2/acts/${encodeURIComponent(actorId)}/runs?token=${token}`;

  let res: Response;
  try {
    res = await fetch(runUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
      cache: "no-store",
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error("[scrape] jobnet run start failed:", detail);
    return { ok: false, reason: "start_failed", detail };
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    console.error(
      `[scrape] jobnet run start failed (HTTP ${res.status}): ${detail}`,
    );
    return { ok: false, reason: "start_failed", detail: `HTTP ${res.status}` };
  }

  const json = (await res.json().catch(() => ({}))) as { data?: { id?: string } };
  const runId = json.data?.id ?? "";
  console.log(
    `[scrape] jobnet run started — runId=${runId}, maxItems=${DAILY_MAX_ITEMS}`,
  );
  return { ok: true, runId, actorId, maxItems: DAILY_MAX_ITEMS };
}
