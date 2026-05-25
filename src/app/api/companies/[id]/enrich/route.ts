import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { enrichCompanyFromCvr, enrichCompanyFromWebsite } from "@/lib/cvr";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// A website scrape can make several slow HTTP requests; give it room.
export const maxDuration = 60;

// Manual (re-)enrichment of a single company. Used by the "retry" affordance in
// the leads UI to refresh stale data or recover from a failed/no_match attempt.
//
// ?source=website  → only run the website scraper.
// (default)        → run CVR first, then fall back to the website scraper if CVR
//                    still left the company without a phone.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const source = request.nextUrl.searchParams.get("source");

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
    .select("id, cvr, name, website")
    .eq("id", id)
    .single();
  if (error || !company) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  // Reset to pending, then run enrichment synchronously (this is a user action,
  // so we want the updated row back in the response).
  const service = createSupabaseServiceClient();

  if (source === "website") {
    await service
      .from("companies")
      .update({ website_scrape_status: "pending" })
      .eq("id", id);
    await enrichCompanyFromWebsite(company.id, company.website);
  } else {
    await service
      .from("companies")
      .update({ cvr_enrichment_status: "pending" })
      .eq("id", id);
    await enrichCompanyFromCvr(company.id, company.cvr, company.name);

    // If CVR still didn't yield a phone and we have a website, scrape it.
    const { data: afterCvr } = await service
      .from("companies")
      .select("phone, website")
      .eq("id", id)
      .single();
    if (afterCvr && !afterCvr.phone && afterCvr.website) {
      await service
        .from("companies")
        .update({ website_scrape_status: "pending" })
        .eq("id", id);
      await enrichCompanyFromWebsite(company.id, afterCvr.website);
    }
  }

  const { data: updated } = await supabase
    .from("companies")
    .select("*")
    .eq("id", id)
    .single();

  return NextResponse.json({ ok: true, company: updated });
}
