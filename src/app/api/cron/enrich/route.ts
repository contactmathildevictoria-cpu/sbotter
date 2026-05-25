import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { enrichPendingCompanies } from "@/lib/cvr";
import { env } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function timingSafeMatch(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a), Buffer.from(b));
  } catch {
    return false;
  }
}

// GET /api/cron/enrich — invoked by Vercel Cron every 6h.
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
    const summary = await enrichPendingCompanies();
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
