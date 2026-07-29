/**
 * Settles one open question about the AI phone layer:
 * can `output_config.format` (response-level JSON schema) be combined with the
 * `web_search_20260209` server tool in a single request?
 *
 * The shipped implementation uses shape B (a strict client-side tool), which
 * works regardless of the answer. Shape A would save one tool round-trip if it
 * turns out to be supported. Run this when you have an ANTHROPIC_API_KEY to
 * find out; if A passes and you prefer it, the change is confined to
 * src/lib/ai-phone.ts + the request constants in src/lib/ai-phone-core.ts.
 *
 * Costs two real API calls with web search. Run:
 *   set -a; . ./.env.local; set +a; node scripts/probe-ai-output-shape.mjs
 */
import Anthropic from "@anthropic-ai/sdk";
import { AI_MODEL, AI_WEB_SEARCH_TOOL } from "../src/lib/ai-phone-core.ts";

if (!process.env.ANTHROPIC_API_KEY) {
  console.error("ANTHROPIC_API_KEY is not set — nothing to probe.");
  process.exit(1);
}

const client = new Anthropic();

const SCHEMA = {
  type: "object",
  properties: {
    phone: { type: ["string", "null"] },
    contactPerson: { type: ["string", "null"] },
    sourceUrl: { type: ["string", "null"] },
  },
  required: ["phone", "contactPerson", "sourceUrl"],
  additionalProperties: false,
};

const PROMPT =
  "Find hovedtelefonnummeret for Netcompany i København. Returnér ALTID den " +
  "præcise kilde-URL nummeret står på. Kan du ikke finde et nummer med en " +
  "kilde, så returnér null i alle felter.";

async function probe(label, params) {
  console.log(`\n=== ${label} ===`);
  try {
    const res = await client.messages.create(params);
    console.log("OK — no 400. stop_reason:", res.stop_reason);
    console.log("blocks:", res.content.map((b) => b.type).join(", "));
    console.log("usage:", JSON.stringify(res.usage));
    return true;
  } catch (err) {
    console.log("FAILED:", err?.status, String(err?.message).slice(0, 300));
    return false;
  }
}

const base = {
  model: AI_MODEL,
  max_tokens: 4096,
  messages: [{ role: "user", content: PROMPT }],
};

const a = await probe("Shape A — output_config.format + web_search", {
  ...base,
  output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
  tools: [AI_WEB_SEARCH_TOOL],
});

const b = await probe("Shape B — web_search + strict report tool (shipped)", {
  ...base,
  output_config: { effort: "low" },
  tools: [
    AI_WEB_SEARCH_TOOL,
    {
      name: "report_phone",
      description: "Report the phone number and the exact source URL.",
      strict: true,
      input_schema: SCHEMA,
    },
  ],
});

console.log(`\nRESULT: A(structured output)=${a}  B(strict tool, shipped)=${b}`);
