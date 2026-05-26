import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { collectCompaniesForKrak, startKrakEnrichmentRun } from "@/lib/krak";
import { env } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Only starts the Apify run and returns — does not await it.
export const maxDuration = 60;

// POST /api/companies/krak-enrich
// Collects companies missing a phone (≤100, oldest first) and starts a Krak.dk
// enricher Actor run. Results arrive later via /api/ingest/krak.
// Auth: a logged-in user, OR Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>.
export async function POST(request: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const authHeader = request.headers.get("authorization");
  const serviceBearer = authHeader === `Bearer ${env.supabaseServiceRoleKey}`;

  if (!user && !serviceBearer) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const companies = await collectCompaniesForKrak();
    if (companies.length === 0) {
      return NextResponse.json({ ok: true, started: 0 });
    }
    const { started, runId } = await startKrakEnrichmentRun(companies);
    return NextResponse.json({ ok: true, started, runId });
  } catch (err) {
    console.error("[krak] krak-enrich failed:", err);
    return NextResponse.json(
      {
        error: "krak_enrich_failed",
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
}
