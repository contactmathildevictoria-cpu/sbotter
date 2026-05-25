import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { enrichPendingCompanies } from "@/lib/cvr";
import { env } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// CVR is rate-limited to 1 call/sec; a 200-row batch can take a few minutes.
export const maxDuration = 300;

// POST /api/companies/enrich-batch
// Enriches pending/failed companies in a batch (40, or 200 with CVRAPI_TOKEN).
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
    const summary = await enrichPendingCompanies();
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
