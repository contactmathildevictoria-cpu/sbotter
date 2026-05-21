import { NextResponse, type NextRequest } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { env } from "@/lib/env";
import {
  fetchApifyDatasetItems,
  processJobnetItems,
} from "@/lib/ingest/apify";

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

function verifySignature(rawBody: string, signature: string | null): boolean {
  if (!signature) return false;
  const secret = env.apifyWebhookSecret;
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  if (signature.length !== expected.length) return false;
  try {
    return timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch {
    return false;
  }
}

export async function POST(request: NextRequest) {
  const signature = request.headers.get("x-sbotter-signature");
  const rawBody = await request.text();

  if (!verifySignature(rawBody, signature)) {
    return NextResponse.json(
      { error: "invalid_signature" },
      { status: 401 },
    );
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
    const result = await processJobnetItems(items, {
      apifyRunId: payload.resource?.id,
      apifyActorId: payload.resource?.actId,
    });
    return NextResponse.json({ ok: true, ...result });
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
