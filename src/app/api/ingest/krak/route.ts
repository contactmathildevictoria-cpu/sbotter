import { NextResponse, type NextRequest } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { env } from "@/lib/env";
import { applyKrakResults, type KrakResult } from "@/lib/krak";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Per-company lookup results the Krak Actor posts back. Same envelope shape every
// Actor uses (eventType + resource + items), but `items` are Krak results keyed
// by the companyId we sent in the run input.
const resultSchema = z.object({
  companyId: z.string().min(1),
  matched: z.boolean(),
  phone: z.string().nullable().optional(),
  contactPerson: z.string().nullable().optional(),
  contactTitle: z.string().nullable().optional(),
  krakUrl: z.string().nullable().optional(),
});

const payloadSchema = z.object({
  eventType: z.string().optional(),
  resource: z
    .object({
      id: z.string().optional(),
      actId: z.string().optional(),
    })
    .optional(),
  items: z.array(resultSchema),
});

function timingSafeMatch(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a), Buffer.from(b));
  } catch {
    return false;
  }
}

// HMAC-SHA256 of the raw body, keyed on the shared APIFY_WEBHOOK_SECRET — the
// same scheme the Krak Actor signs with (see apify-actors/krak-enricher).
function verifySignature(rawBody: string, signature: string | null): boolean {
  if (!signature) return false;
  const expected = createHmac("sha256", env.apifyWebhookSecret)
    .update(rawBody)
    .digest("hex");
  return timingSafeMatch(signature, expected);
}

// POST /api/ingest/krak
// Receives Krak enrichment results and fills the dedicated krak_* columns
// (never overwriting CVR data). Auth: HMAC x-sbotter-signature over the raw body.
export async function POST(request: NextRequest) {
  const signature = request.headers.get("x-sbotter-signature");
  const rawBody = await request.text();

  if (!verifySignature(rawBody, signature)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let payload: z.infer<typeof payloadSchema>;
  try {
    payload = payloadSchema.parse(JSON.parse(rawBody));
  } catch (err) {
    return NextResponse.json(
      {
        error: "invalid_payload",
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 400 },
    );
  }

  try {
    const result = await applyKrakResults(payload.items as KrakResult[]);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return NextResponse.json(
      {
        error: "krak_apply_failed",
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
}
