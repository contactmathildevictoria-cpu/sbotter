import { NextResponse, type NextRequest } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { env } from "@/lib/env";
import {
  fetchApifyDatasetItems,
  processIngestItems,
} from "@/lib/ingest/apify";
import { SOURCE_IDS, type SourceId } from "@/lib/ingest/normalize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const payloadSchema = z.object({
  // Real Apify webhooks send eventType + resource.defaultDatasetId; for local
  // testing we accept an inline `items` array, bypassing the dataset fetch.
  eventType: z.string().optional(),
  resource: z
    .object({
      id: z.string().optional(),
      actId: z.string().optional(),
      defaultDatasetId: z.string().optional(),
    })
    .optional(),
  items: z.array(z.unknown()).optional(),
});

function timingSafeMatch(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a), Buffer.from(b));
  } catch {
    return false;
  }
}

// HMAC-SHA256 of the raw body — used by our own Crawlee Actor and local tests,
// which can compute the signature from the shared APIFY_WEBHOOK_SECRET.
function verifySignature(rawBody: string, signature: string | null): boolean {
  if (!signature) return false;
  const expected = createHmac("sha256", env.apifyWebhookSecret)
    .update(rawBody)
    .digest("hex");
  return timingSafeMatch(signature, expected);
}

// Static bearer token — used by Apify's native webhooks, which can't compute our
// HMAC but can send a fixed `Authorization: Bearer <token>` header.
function verifyBearerToken(authHeader: string | null): boolean {
  if (!authHeader) return false;
  const expected = env.apifyWebhookToken;
  if (!expected) return false;
  const prefix = "Bearer ";
  if (!authHeader.startsWith(prefix)) return false;
  return timingSafeMatch(authHeader.slice(prefix.length).trim(), expected);
}

export async function POST(request: NextRequest) {
  const signature = request.headers.get("x-sbotter-signature");
  const rawBody = await request.text();

  // Accept either auth method: HMAC signature first (local/Actor), then a static
  // bearer token (Apify native webhooks).
  const authorized =
    verifySignature(rawBody, signature) ||
    verifyBearerToken(request.headers.get("authorization"));

  if (!authorized) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Which source is this batch from? Each Actor appends ?source=<id> to its
  // webhook URL. The param lives outside the signed body, so it never affects
  // the HMAC. Validate against the allowlist (after auth, so unauthorized
  // callers can't probe valid source ids). Defaults to jobnet for back-compat.
  const source = new URL(request.url).searchParams.get("source") ?? "jobnet";
  if (!SOURCE_IDS.has(source as SourceId)) {
    return NextResponse.json({ error: "unknown_source" }, { status: 400 });
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

  let items: unknown[];
  try {
    if (payload.items && payload.items.length > 0) {
      items = payload.items;
    } else if (payload.resource?.defaultDatasetId) {
      items = await fetchApifyDatasetItems(payload.resource.defaultDatasetId);
    } else {
      return NextResponse.json(
        { error: "missing_items_or_dataset" },
        { status: 400 },
      );
    }
  } catch (err) {
    return NextResponse.json(
      {
        error: "dataset_fetch_failed",
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 502 },
    );
  }

  try {
    const { enrichmentCandidates, ...result } = await processIngestItems(
      items,
      source as SourceId,
      {
        apifyRunId: payload.resource?.id,
        apifyActorId: payload.resource?.actId,
      },
    );

    // CVR enrichment is NOT done here: fire-and-forget promises get killed when
    // a serverless response is sent. New companies are left as 'pending' and the
    // cron job (/api/cron/enrich, every 6h) enriches them reliably + rate-limited.
    return NextResponse.json({
      ok: true,
      ...result,
      enrichmentPending: enrichmentCandidates.length,
    });
  } catch (err) {
    return NextResponse.json(
      {
        error: "ingest_failed",
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
}
