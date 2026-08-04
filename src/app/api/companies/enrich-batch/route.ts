import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { enrichPendingCompanies } from "@/lib/cvr";
import { env } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// CVR lookups are paced against the provider's per-minute limit, and the
// website passes are slow, so a full run can take a few minutes.
export const maxDuration = 300;

/**
 * Wall-clock budget for the batch, 100s inside maxDuration.
 *
 * This endpoint backs an interactive button, so it must always return a
 * response. The passes stop between companies once the budget is spent and
 * report `stoppedOnTime`; whatever wasn't reached stays queued for the next run.
 */
const BUDGET_MS = 200_000;

// POST /api/companies/enrich-batch
// Runs the three FAST passes (CVR, website discovery, website scrape) on
// pending/failed companies, up to 200 CVR lookups per run.
//
// The AI phone lookup is deliberately NOT run here: one lookup can take ~40s,
// and a batch of them used to push this past maxDuration, so the request never
// returned cleanly and the button's spinner never reset. It runs on its own
// schedule at /api/cron/ai-phone.
//
// Auth: a logged-in user, OR Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>.
export async function POST(request: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const authHeader = request.headers.get("authorization");
  const serviceBearer =
    authHeader === `Bearer ${env.supabaseServiceRoleKey}`;

  if (!user && !serviceBearer) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const summary = await enrichPendingCompanies({ budgetMs: BUDGET_MS });
    return NextResponse.json({ ok: true, ...summary });
  } catch (err) {
    console.error("[cvr] enrich-batch failed:", err);
    return NextResponse.json(
      {
        error: "batch_failed",
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
}
