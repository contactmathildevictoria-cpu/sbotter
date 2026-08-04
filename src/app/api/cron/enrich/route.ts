import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { enrichPendingCompanies } from "@/lib/cvr";
import { env } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 800s — the maximum a Pro team can give a single function (Hobby caps at 300s;
 * 1800s exists but only via the extended-duration beta).
 *
 * Worth knowing before tuning this further: the function limit is NOT what
 * bounds a run. The CVR provider allows 20 lookups/minute, so a run can never
 * do more than `duration_in_minutes × 20` companies however long we let it
 * live. At 800s that's ~266. Draining a deep queue is therefore a matter of
 * running this often (see the cron schedule in vercel.json), not of running it
 * longer.
 */
export const maxDuration = 800;

/**
 * Wall-clock budget for the passes, 100s inside maxDuration so the function
 * always returns a response instead of being killed mid-write. With the cron
 * firing every 15 minutes (900s), this also guarantees a run finishes well
 * before the next one starts.
 */
const BUDGET_MS = 700_000;

function timingSafeMatch(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a), Buffer.from(b));
  } catch {
    return false;
  }
}

// GET /api/cron/enrich — invoked by Vercel Cron every 15 minutes.
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

  try {
    const summary = await enrichPendingCompanies({ budgetMs: BUDGET_MS });
    return NextResponse.json({ ok: true, ...summary });
  } catch (err) {
    console.error("[cvr] cron enrich failed:", err);
    return NextResponse.json(
      {
        error: "cron_failed",
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
}
