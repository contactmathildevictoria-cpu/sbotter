import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { env } from "@/lib/env";
import {
  AI_EFFORT,
  AI_MODEL,
  AI_REPORT_TOOL,
  AI_SYSTEM_PROMPT,
  AI_WEB_SEARCH_TOOL,
  buildAiUserPrompt,
  countWebSearches,
  decideAiWrite,
  extractAiResultFromResponse,
  type AiPhoneCompany,
  type AiPhoneResult,
} from "@/lib/ai-phone-core";

/**
 * The I/O half of the AI phone layer. All decision-making lives in
 * ai-phone-core.ts; this file makes the call and writes the row.
 *
 * Best-effort like the other three layers: never throws, returns null on any
 * failure or timeout so one bad company can't stall a batch.
 */

/** Hard ceiling on a single lookup. Web search makes these slow. */
const AI_TIMEOUT_MS = 90_000;
const AI_MAX_TOKENS = 4096;

export type AiLookup = {
  result: AiPhoneResult | null;
  /** For cost tracking — see the Pass 4 log line. */
  webSearches: number;
  inputTokens: number;
  outputTokens: number;
};

let client: Anthropic | null = null;

function getClient(apiKey: string): Anthropic {
  // The SDK client is stateless and safe to reuse across calls.
  client ??= new Anthropic({
    apiKey,
    // The TS SDK takes milliseconds. Retries are on top of this, so the
    // worst-case wall clock is timeout x (maxRetries + 1).
    timeout: AI_TIMEOUT_MS,
    maxRetries: 1,
  });
  return client;
}

/**
 * Looks up a company's phone number with an LLM that can search the web.
 *
 * Returns null when the layer is switched off, the key is unset, the call
 * fails, the model reports nothing, or what it reported fails validation (no
 * source URL, or not a plausible Danish number).
 *
 * This is the single choke point for the Anthropic API in this repo: nothing
 * else calls it, so the ENABLE_AI_ENRICHMENT guard below is enough to
 * guarantee no billed request leaves the app.
 */
export async function findPhoneViaAI(
  company: AiPhoneCompany,
): Promise<AiLookup | null> {
  if (!env.enableAiEnrichment) {
    console.log(
      `[ai] lookup skipped for ${company.name} — ENABLE_AI_ENRICHMENT is off`,
    );
    return null;
  }

  const apiKey = env.anthropicApiKey;
  if (!apiKey) return null;

  try {
    const response = await getClient(apiKey).messages.create({
      model: AI_MODEL,
      max_tokens: AI_MAX_TOKENS,
      // Thinking is on by default on this model and counts against max_tokens.
      output_config: { effort: AI_EFFORT },
      system: AI_SYSTEM_PROMPT,
      tools: [AI_WEB_SEARCH_TOOL, AI_REPORT_TOOL],
      messages: [{ role: "user", content: buildAiUserPrompt(company) }],
    } as Anthropic.MessageCreateParamsNonStreaming);

    // Safety classifiers can decline a request: HTTP 200, empty/partial
    // content. Check before reading content.
    if (response.stop_reason === "refusal") {
      console.warn(`[ai] refused for ${company.name}`);
      return {
        result: null,
        webSearches: 0,
        inputTokens: response.usage?.input_tokens ?? 0,
        outputTokens: response.usage?.output_tokens ?? 0,
      };
    }

    const content = response.content as unknown as Parameters<
      typeof extractAiResultFromResponse
    >[0];

    return {
      result: extractAiResultFromResponse(content),
      webSearches: countWebSearches(content),
      inputTokens: response.usage?.input_tokens ?? 0,
      outputTokens: response.usage?.output_tokens ?? 0,
    };
  } catch (err) {
    console.error(`[ai] lookup failed for ${company.name}:`, err);
    return null;
  }
}

export type AiApplyStatus = "enriched" | "no_match" | "failed" | "skipped";

/**
 * Writes an AI result. FILL-EMPTY-ONLY: touches only the ai_* columns and the
 * status, never the canonical phone / any CVR or website column.
 *
 * Re-reads the trusted phone columns first, so a company that gained a number
 * from another layer since the batch selected it is retired as `skipped` and
 * the AI number is discarded rather than stored.
 */
export async function applyAiPhoneResult(
  companyId: string,
  result: AiPhoneResult | null,
): Promise<AiApplyStatus> {
  const supabase = createSupabaseServiceClient();
  const now = new Date().toISOString();

  const { data: company, error: readError } = await supabase
    .from("companies")
    .select("phone, website_phone")
    .eq("id", companyId)
    .maybeSingle();

  if (readError || !company) {
    console.error(`[ai] failed to re-read company ${companyId}:`, readError);
    return "failed";
  }

  const decision = decideAiWrite(company, result);

  const update = decision.store
    ? {
        ai_phone: result!.phone,
        ai_contact_person: result!.contactPerson,
        ai_source_url: result!.sourceUrl,
        ai_enriched_at: now,
        ai_enrichment_status: "enriched" as const,
      }
    : {
        ai_enriched_at: now,
        ai_enrichment_status: decision.status,
      };

  const { error } = await supabase
    .from("companies")
    .update(update)
    .eq("id", companyId);

  if (error) {
    console.error(`[ai] failed to update company ${companyId}:`, error);
    return "failed";
  }

  return decision.store ? "enriched" : decision.status;
}
