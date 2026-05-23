import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { enrichCompanyFromCvr } from "@/lib/cvr";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Manual (re-)enrichment of a single company. Used by the "retry" affordance in
// the leads UI to refresh stale data or recover from a failed/no_match attempt.
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  // Gate: authenticated users only.
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Look up the company (RLS lets authenticated users read).
  const { data: company, error } = await supabase
    .from("companies")
    .select("id, cvr, name")
    .eq("id", id)
    .single();
  if (error || !company) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  // Reset to pending, then run enrichment synchronously (this is a user action,
  // so we want the updated row back in the response).
  const service = createSupabaseServiceClient();
  await service
    .from("companies")
    .update({ cvr_enrichment_status: "pending" })
    .eq("id", id);

  await enrichCompanyFromCvr(company.id, company.cvr, company.name);

  const { data: updated } = await supabase
    .from("companies")
    .select("*")
    .eq("id", id)
    .single();

  return NextResponse.json({ ok: true, company: updated });
}
