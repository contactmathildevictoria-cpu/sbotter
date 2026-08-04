import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { runAiPhonePass } from "@/lib/cvr";
import { env } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Leave 60s of headroom inside maxDuration. runAiPhonePass stops before
 * starting a lookup it can't finish, so a run always returns a summary rather
 * than being killed mid-flight.
 */
const BUDGET_MS = 240_000;
/** Five lookups at ~40s each fits the budget with room to spare. */
const LIMIT = 5;

function timingSafeMatch(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a), Buffer.from(b));
  } catch {
    return false;
  }
}

// GET /api/cron/ai-phone — MANUAL ONLY.
//
// Deliberately absent from vercel.json: the AI layer costs a billed web search
// plus Opus tokens per company, so it no longer runs on a schedule. Trigger a
// batch by hand when you want one:
//
//   curl -H "Authorization: Bearer $CRON_SECRET" https://<host>/api/cron/ai-phone
//
// It still returns immediately with `skippedDisabled: true` unless
// ENABLE_AI_ENRICHMENT is "true" — the flag is the real switch, this route just
// stopped firing on its own.
//
// The lookup lives here rather than in /api/companies/enrich-batch on purpose:
// one lookup runs a web search and can take ~40s, so a handful of them exceeds
// any interactive request's time limit. Keeping it off the batch is what stops
// the "Enrich all" button from hanging.
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
    const summary = await runAiPhonePass({ limit: LIMIT, budgetMs: BUDGET_MS });
    return NextResponse.json({ ok: true, ...summary });
  } catch (err) {
    console.error("[ai] cron ai-phone failed:", err);
    return NextResponse.json(
      {
        error: "cron_failed",
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
}
