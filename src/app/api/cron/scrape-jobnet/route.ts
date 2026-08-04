import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { startJobnetScrapeRun } from "@/lib/scrape";
import { env } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// This only starts the Apify run and returns; the Actor scrapes for minutes
// afterwards on Apify's infrastructure and POSTs its results to
// /api/ingest/apify. No need for the 300s ceiling the batch routes use.
export const maxDuration = 60;

function timingSafeMatch(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a), Buffer.from(b));
  } catch {
    return false;
  }
}

// GET /api/cron/scrape-jobnet — invoked by Vercel Cron daily at 02:00 UTC.
//
// Jobnet is the one source with a real scraper, and nothing was running it on a
// schedule, so the pool had gone ~2 months stale. Scheduled two hours ahead of
// the daily-list cron (04:00) so the morning's lists are built on data ingested
// the same night.
//
// A missing JOBNET_ACTOR_ID or APIFY_TOKEN is a clean no-op with a log line —
// the Actor still has to be `apify push`ed, see docs/apify-jobnet-deployment.md.
export async function GET(request: NextRequest) {
  const secret = env.cronSecret;
  if (!secret) {
    // Misconfiguration: refuse rather than run unauthenticated.
    return NextResponse.json({ error: "cron_not_configured" }, { status: 500 });
  }

  const authHeader = request.headers.get("authorization") ?? "";
  const prefix = "Bearer ";
  const provided = authHeader.startsWith(prefix)
    ? authHeader.slice(prefix.length)
    : "";
  if (!timingSafeMatch(provided, secret)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const result = await startJobnetScrapeRun();

    if (!result.ok) {
      // Not configured yet, or Apify rejected the start. Either way this is a
      // 200 with a reason: a cron that returns 500 gets retried and alerted on,
      // and neither helps when the Actor simply isn't deployed.
      return NextResponse.json({
        ok: false,
        started: false,
        reason: result.reason,
        detail: result.detail,
      });
    }

    return NextResponse.json({
      ok: true,
      started: true,
      runId: result.runId,
      actorId: result.actorId,
      maxItems: result.maxItems,
    });
  } catch (err) {
    console.error("[scrape] cron scrape-jobnet failed:", err);
    return NextResponse.json(
      {
        error: "cron_failed",
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
}
