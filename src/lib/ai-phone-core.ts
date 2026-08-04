/**
 * The fourth phone layer: request shaping and result validation.
 *
 * PURE. No I/O, no Supabase, no SDK client, no `server-only`. Everything an
 * LLM answer has to survive before it can be stored lives here, so it can be
 * tested against fabricated model responses without touching the API.
 * `ai-phone.ts` is the thin wrapper that makes the call and writes the row.
 *
 * The rule this file enforces: a model can invent a realistic-looking phone
 * number, so a number is only ever accepted when the model also points at the
 * source URL it read it from. No source URL, no number.
 */

import { normalizePhone } from "@/lib/phone";

/**
 * The model. Isolated here on purpose — switching to `claude-sonnet-5` (or any
 * other model supporting the web_search_20260209 tool) is this one line.
 */
export const AI_MODEL = "claude-opus-5";

/**
 * `effort: "low"` is the primary cost lever on this model, and is documented as
 * unusually strong on it. Raise if the long tail proves too hard.
 */
export const AI_EFFORT = "low";

/** Web search with dynamic filtering. Requires Opus 4.6+ / Sonnet 4.6+. */
export const AI_WEB_SEARCH_TOOL = {
  type: "web_search_20260209",
  name: "web_search",
  max_uses: 5,
} as const;

/** The name the model reports its answer through. */
export const AI_REPORT_TOOL_NAME = "report_phone";

/**
 * The model answers by calling this tool rather than via `output_config.format`.
 *
 * Both shapes were considered. This one is chosen because it is the documented
 * way to combine a structured payload with a server-side tool in the same
 * request, and it does not depend on whether response-level JSON schema
 * composes with server tools — a question that could not be settled empirically
 * here (see docs/ai-phone-layer.md). `strict: true` makes the API guarantee the
 * arguments match the schema.
 */
export const AI_REPORT_TOOL = {
  name: AI_REPORT_TOOL_NAME,
  description:
    "Report the company's main phone number, an optional contact person, and " +
    "the exact URL of the page the number was read from. Call this exactly " +
    "once. If no phone number backed by a source page could be found, call it " +
    "with all fields null.",
  strict: true,
  input_schema: {
    type: "object",
    properties: {
      phone: {
        type: ["string", "null"],
        description: "The Danish phone number exactly as written on the source page.",
      },
      contactPerson: {
        type: ["string", "null"],
        description: "Name of a named contact person, if the page lists one.",
      },
      sourceUrl: {
        type: ["string", "null"],
        description:
          "The exact http(s) URL of the page the phone number appears on. Required whenever phone is set.",
      },
    },
    required: ["phone", "contactPerson", "sourceUrl"],
    additionalProperties: false,
  },
} as const;

export const AI_SYSTEM_PROMPT = [
  "Du finder hovedtelefonnummeret på danske virksomheder ved at søge på nettet.",
  "",
  "Regler:",
  "1. Søg efter virksomhedens officielle hovednummer (dansk, 8 cifre).",
  "2. Du må KUN rapportere et nummer, du kan pege på en konkret kilde-URL for,",
  "   hvor nummeret rent faktisk står. Gæt aldrig, og udled aldrig et nummer",
  "   ud fra mønstre, andre virksomheder eller din egen hukommelse.",
  "3. Kan du ikke finde et nummer med en kilde, så kald report_phone med null",
  "   i alle felter. Det er et fuldt acceptabelt svar og bedre end et gæt.",
  "4. Rapportér kun en kontaktperson, hvis samme kilde nævner en ved navn.",
  "5. Kald report_phone præcis én gang, når du er færdig.",
].join("\n");

export type AiPhoneCompany = {
  name: string;
  city?: string | null;
  website?: string | null;
};

export function buildAiUserPrompt(company: AiPhoneCompany): string {
  const lines = [`Virksomhed: ${company.name}`];
  if (company.city) lines.push(`By: ${company.city}`);
  if (company.website) lines.push(`Hjemmeside: ${company.website}`);
  lines.push("", "Find virksomhedens hovedtelefonnummer og rapportér via report_phone.");
  return lines.join("\n");
}

/** What the model claimed, before validation. */
export type RawAiResult = {
  phone?: unknown;
  contactPerson?: unknown;
  sourceUrl?: unknown;
};

/** A result that survived validation and may be stored. */
export type AiPhoneResult = {
  /** Normalized to a bare 8-digit Danish number. */
  phone: string;
  contactPerson: string | null;
  /** Always present — this is the whole point of the layer. */
  sourceUrl: string;
};

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Turns a model claim into something storable, or null.
 *
 * Rejects, in order: a missing/blank phone; a missing, non-string, or
 * non-http(s) source URL; and anything `normalizePhone` doesn't accept as a
 * plausible Danish number (wrong digit count, repdigits like 11111111).
 */
export function validateAiResult(raw: RawAiResult | null | undefined): AiPhoneResult | null {
  if (!raw) return null;

  const { phone, contactPerson, sourceUrl } = raw;

  if (typeof phone !== "string" || phone.trim().length === 0) return null;

  // Provenance is mandatory. A number we can't point at is a number we don't
  // store, however plausible it looks.
  if (typeof sourceUrl !== "string" || !isHttpUrl(sourceUrl.trim())) return null;

  // Same rules as the website scraper — one definition of a valid DK number.
  const normalized = normalizePhone(phone);
  if (!normalized) return null;

  const person =
    typeof contactPerson === "string" && contactPerson.trim().length > 0
      ? contactPerson.trim().slice(0, 200)
      : null;

  return {
    phone: normalized.key,
    contactPerson: person,
    sourceUrl: sourceUrl.trim(),
  };
}

/** The subset of a `content` block the extractor cares about. */
export type AiContentBlock = {
  type: string;
  name?: string;
  input?: unknown;
};

/**
 * Pulls the reported result out of a model response and validates it.
 *
 * Takes the first `report_phone` tool call; ignores web-search blocks and any
 * prose. Returns null if the model never reported, or reported nothing usable.
 */
export function extractAiResultFromResponse(
  content: readonly AiContentBlock[] | null | undefined,
): AiPhoneResult | null {
  if (!content) return null;
  for (const block of content) {
    if (block.type !== "tool_use" || block.name !== AI_REPORT_TOOL_NAME) continue;
    const input = block.input;
    if (typeof input !== "object" || input === null) return null;
    return validateAiResult(input as RawAiResult);
  }
  return null;
}

/** How many web searches the model ran, for cost tracking. */
export function countWebSearches(
  content: readonly AiContentBlock[] | null | undefined,
): number {
  if (!content) return 0;
  let n = 0;
  for (const block of content) {
    if (block.type === "server_tool_use" && block.name === "web_search") n++;
  }
  return n;
}

/** The phone columns of the trusted layers. */
export type TrustedPhoneColumns = {
  phone: string | null;
  website_phone: string | null;
};

export type AiWriteDecision =
  | { store: true; status: "enriched" }
  | { store: false; status: "skipped" | "no_match" };

/**
 * FILL-EMPTY-ONLY. Decides whether an AI result may be written.
 *
 * A company that has gained a phone from CVR or the website scraper since the
 * batch selected it is retired as `skipped` — the AI number is discarded, not
 * stored as a lower-priority alternative. This is the second of the two guards;
 * the batch query is the first.
 */
export function decideAiWrite(
  company: TrustedPhoneColumns,
  result: AiPhoneResult | null,
): AiWriteDecision {
  const hasTrustedPhone = Boolean(company.phone) || Boolean(company.website_phone);

  if (hasTrustedPhone) return { store: false, status: "skipped" };
  if (!result) return { store: false, status: "no_match" };
  return { store: true, status: "enriched" };
}
