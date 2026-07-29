import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { parseFiltersFromSearchParams } from "@/lib/leads/filters";
import { resolveCompanyContact } from "@/lib/leads/contact";
import { fetchCompanies } from "@/lib/leads/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Exports every matching company (all pages), so allow a little headroom.
export const maxDuration = 60;

// Escape a value for a CSV cell (RFC 4180): quote when it contains a comma,
// quote, or newline, and double any embedded quotes.
function csvCell(value: string | number | null | undefined): string {
  const s = value === null || value === undefined ? "" : String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const HEADERS = [
  "Company name",
  "Phone",
  // Which layer the phone came from, and — for AI-found numbers — the page it
  // was read from. An AI number must never leave the system unmarked.
  "Phone source",
  "Phone source URL",
  "Email",
  "Contact person",
  "Website",
  "Location",
  "Open jobs",
  "CVR status",
  "Website scrape status",
];

// GET /api/companies/export?<same filter params as the leads page>
// Streams ALL matching companies (not just the current page) as CSV.
// Phone/email/contact use the same CVR → website → Krak → AI cascade as the
// table, including the AI provenance columns.
export async function GET(request: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Honor the current filters, but always export every page.
  const filters = {
    ...parseFiltersFromSearchParams(
      Object.fromEntries(request.nextUrl.searchParams),
    ),
    perPage: "all" as const,
    page: 1,
  };

  const { rows } = await fetchCompanies(filters);

  const lines = [HEADERS.join(",")];
  for (const r of rows) {
    const { phone, phoneSource, phoneSourceUrl, email, contactName } =
      resolveCompanyContact(r);
    const location = [r.location_city, r.country].filter(Boolean).join(", ");
    lines.push(
      [
        csvCell(r.name),
        csvCell(phone),
        csvCell(phoneSource),
        csvCell(phoneSourceUrl),
        csvCell(email),
        csvCell(contactName),
        csvCell(r.website),
        csvCell(location),
        csvCell(r.open_jobs_count),
        csvCell(r.cvr_enrichment_status),
        csvCell(r.website_scrape_status),
      ].join(","),
    );
  }

  // BOM (U+FEFF) so Excel reads Danish characters correctly; CRLF row separators.
  const csv = String.fromCharCode(0xfeff) + lines.join("\r\n");
  const date = new Date().toISOString().slice(0, 10);

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="leads-${date}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
