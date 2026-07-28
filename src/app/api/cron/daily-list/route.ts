import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { generateDailyList } from "@/lib/leads/daily-list";
import { todayInCopenhagen } from "@/lib/leads/daily-list-core";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { env } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Leave headroom inside maxDuration so we can still return a summary. */
const BUDGET_MS = 270_000;
const USER_PAGE = 1000;

function timingSafeMatch(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a), Buffer.from(b));
  } catch {
    return false;
  }
}

// GET /api/cron/daily-list — invoked by Vercel Cron every morning.
// Vercel sends `Authorization: Bearer <CRON_SECRET>` when CRON_SECRET is set.
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

  const startedAt = Date.now();
  const supabase = createSupabaseServiceClient();

  // profiles, not auth.users — the latter isn't exposed through PostgREST.
  // profiles is 1:1 with it.
  const userIds: string[] = [];
  try {
    for (let from = 0; ; from += USER_PAGE) {
      const { data, error } = await supabase
        .from("profiles")
        .select("id")
        .order("created_at", { ascending: true })
        .range(from, from + USER_PAGE - 1);
      if (error) throw error;
      if (!data || data.length === 0) break;
      userIds.push(...data.map((u) => u.id));
      if (data.length < USER_PAGE) break;
    }
  } catch (err) {
    console.error("[daily-list] failed to enumerate users:", err);
    return NextResponse.json(
      {
        error: "cron_failed",
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }

  // One date for the whole run, so a run that straddles midnight stays
  // internally consistent.
  const today = todayInCopenhagen();

  let processed = 0;
  let failed = 0;
  let fresh = 0;
  let recycled = 0;
  let fill = 0;
  let stoppedOnTime = false;

  for (const userId of userIds) {
    if (Date.now() - startedAt > BUDGET_MS) {
      stoppedOnTime = true;
      break;
    }
    try {
      const summary = await generateDailyList(userId, today);
      fresh += summary.fresh;
      recycled += summary.recycled;
      fill += summary.fill;
      processed++;
    } catch (err) {
      // Never abort the loop: one user with bad data must not starve the rest.
      failed++;
      console.error(`[daily-list] user ${userId} failed:`, err);
    }
  }

  return NextResponse.json({
    ok: true,
    date: today,
    users: userIds.length,
    processed,
    failed,
    fresh,
    recycled,
    fill,
    total: fresh + recycled + fill,
    stoppedOnTime,
  });
}
