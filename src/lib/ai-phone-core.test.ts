import { describe, expect, it } from "vitest";
import {
  AI_MODEL,
  AI_REPORT_TOOL,
  buildAiUserPrompt,
  countWebSearches,
  decideAiWrite,
  extractAiResultFromResponse,
  validateAiResult,
  type AiContentBlock,
  type AiPhoneResult,
} from "@/lib/ai-phone-core";

const GOOD = {
  phone: "70 20 80 60",
  contactPerson: "Mette Hansen",
  sourceUrl: "https://www.proff.dk/firma/eksempel-aps/12345678",
};

/** A fabricated model response — this is the mock for the LLM call. */
function responseWith(input: unknown, searches = 1): AiContentBlock[] {
  return [
    ...Array.from({ length: searches }, () => ({
      type: "server_tool_use",
      name: "web_search",
    })),
    { type: "web_search_tool_result", name: "web_search" },
    { type: "text" },
    { type: "tool_use", name: "report_phone", input },
  ];
}

// ============================================================
// Provenance — the reason this layer exists
// ============================================================
describe("validateAiResult — source URL is mandatory", () => {
  it("accepts a number that comes with a source URL", () => {
    expect(validateAiResult(GOOD)).toEqual({
      phone: "70208060",
      contactPerson: "Mette Hansen",
      sourceUrl: GOOD.sourceUrl,
    });
  });

  it("discards a number with no source URL at all", () => {
    // The core failure mode: a realistic-looking number the model made up.
    expect(validateAiResult({ ...GOOD, sourceUrl: undefined })).toBeNull();
    expect(validateAiResult({ ...GOOD, sourceUrl: null })).toBeNull();
  });

  it("discards a number whose source URL is blank or whitespace", () => {
    expect(validateAiResult({ ...GOOD, sourceUrl: "" })).toBeNull();
    expect(validateAiResult({ ...GOOD, sourceUrl: "   " })).toBeNull();
  });

  it("discards a source URL that isn't a real http(s) URL", () => {
    expect(validateAiResult({ ...GOOD, sourceUrl: "proff.dk" })).toBeNull();
    expect(validateAiResult({ ...GOOD, sourceUrl: "ifølge min viden" })).toBeNull();
    expect(validateAiResult({ ...GOOD, sourceUrl: "javascript:alert(1)" })).toBeNull();
    expect(validateAiResult({ ...GOOD, sourceUrl: "file:///etc/passwd" })).toBeNull();
  });

  it("discards a non-string source URL", () => {
    expect(validateAiResult({ ...GOOD, sourceUrl: 42 })).toBeNull();
    expect(validateAiResult({ ...GOOD, sourceUrl: { url: GOOD.sourceUrl } })).toBeNull();
  });

  it("accepts http as well as https", () => {
    expect(validateAiResult({ ...GOOD, sourceUrl: "http://eksempel.dk/kontakt" }))
      .not.toBeNull();
  });
});

// ============================================================
// Phone format
// ============================================================
describe("validateAiResult — phone format", () => {
  it("normalizes to a bare 8-digit number", () => {
    for (const raw of ["70 20 80 60", "70208060", "+45 70 20 80 60", "0045 70208060"]) {
      expect(validateAiResult({ ...GOOD, phone: raw })?.phone).toBe("70208060");
    }
  });

  it("discards anything that isn't a plausible Danish number", () => {
    for (const raw of ["1234567", "123456789", "+1 415 555 0100", "abc", "20"]) {
      expect(validateAiResult({ ...GOOD, phone: raw })).toBeNull();
    }
  });

  it("discards repdigit placeholders", () => {
    expect(validateAiResult({ ...GOOD, phone: "11111111" })).toBeNull();
    expect(validateAiResult({ ...GOOD, phone: "00000000" })).toBeNull();
  });

  it("discards a missing, blank or non-string phone", () => {
    expect(validateAiResult({ ...GOOD, phone: null })).toBeNull();
    expect(validateAiResult({ ...GOOD, phone: "" })).toBeNull();
    expect(validateAiResult({ ...GOOD, phone: "   " })).toBeNull();
    expect(validateAiResult({ ...GOOD, phone: 70208060 })).toBeNull();
  });

  it("handles the model reporting nothing found", () => {
    expect(
      validateAiResult({ phone: null, contactPerson: null, sourceUrl: null }),
    ).toBeNull();
    expect(validateAiResult(null)).toBeNull();
    expect(validateAiResult(undefined)).toBeNull();
  });
});

describe("validateAiResult — contact person", () => {
  it("keeps a named contact and trims it", () => {
    expect(validateAiResult({ ...GOOD, contactPerson: "  Jens Jensen  " })?.contactPerson)
      .toBe("Jens Jensen");
  });

  it("is null when absent, blank or not a string", () => {
    for (const v of [null, undefined, "", "   ", 42]) {
      expect(validateAiResult({ ...GOOD, contactPerson: v })?.contactPerson).toBeNull();
    }
  });

  it("caps an absurdly long name", () => {
    const long = "a".repeat(500);
    expect(validateAiResult({ ...GOOD, contactPerson: long })?.contactPerson)
      .toHaveLength(200);
  });
});

// ============================================================
// Response extraction — stands in for the LLM call
// ============================================================
describe("extractAiResultFromResponse", () => {
  it("pulls the reported result out of a full response", () => {
    expect(extractAiResultFromResponse(responseWith(GOOD))?.phone).toBe("70208060");
  });

  it("returns null when the model never called the report tool", () => {
    const noReport: AiContentBlock[] = [
      { type: "server_tool_use", name: "web_search" },
      { type: "text" },
    ];
    expect(extractAiResultFromResponse(noReport)).toBeNull();
  });

  it("ignores a different tool call", () => {
    const other: AiContentBlock[] = [
      { type: "tool_use", name: "something_else", input: GOOD },
    ];
    expect(extractAiResultFromResponse(other)).toBeNull();
  });

  it("validates the reported payload rather than trusting it", () => {
    // A well-formed tool call carrying an unsourced number must not pass.
    expect(
      extractAiResultFromResponse(responseWith({ ...GOOD, sourceUrl: null })),
    ).toBeNull();
    expect(
      extractAiResultFromResponse(responseWith({ ...GOOD, phone: "11111111" })),
    ).toBeNull();
  });

  it("survives a malformed or empty response", () => {
    expect(extractAiResultFromResponse(null)).toBeNull();
    expect(extractAiResultFromResponse([])).toBeNull();
    expect(extractAiResultFromResponse(responseWith("not an object"))).toBeNull();
    expect(extractAiResultFromResponse(responseWith(null))).toBeNull();
  });
});

describe("countWebSearches", () => {
  it("counts the model's web searches for cost tracking", () => {
    expect(countWebSearches(responseWith(GOOD, 3))).toBe(3);
    expect(countWebSearches(responseWith(GOOD, 0))).toBe(0);
    expect(countWebSearches(null)).toBe(0);
  });
});

// ============================================================
// Fill-empty-only
// ============================================================
describe("decideAiWrite — fill-empty-only", () => {
  const result: AiPhoneResult = {
    phone: "70208060",
    contactPerson: null,
    sourceUrl: GOOD.sourceUrl,
  };
  const empty = { phone: null, website_phone: null };

  it("stores when no trusted layer has a phone", () => {
    expect(decideAiWrite(empty, result)).toEqual({ store: true, status: "enriched" });
  });

  it("never overwrites a CVR phone", () => {
    expect(decideAiWrite({ ...empty, phone: "12345678" }, result))
      .toEqual({ store: false, status: "skipped" });
  });

  it("never overwrites a website-scraped phone", () => {
    expect(decideAiWrite({ ...empty, website_phone: "12345678" }, result))
      .toEqual({ store: false, status: "skipped" });
  });

  it("skips rather than stores when a phone arrived mid-batch", () => {
    // The batch query already filtered these out; this is the second guard,
    // covering the window between selection and write.
    const decision = decideAiWrite({ ...empty, phone: "12345678" }, result);
    expect(decision.store).toBe(false);
  });

  it("records no_match when nothing usable was found", () => {
    expect(decideAiWrite(empty, null)).toEqual({ store: false, status: "no_match" });
  });

  it("prefers skipped over no_match when a trusted phone exists", () => {
    expect(decideAiWrite({ ...empty, phone: "12345678" }, null))
      .toEqual({ store: false, status: "skipped" });
  });
});

// ============================================================
// Request shape
// ============================================================
describe("request shape", () => {
  it("pins the model in exactly one place", () => {
    expect(AI_MODEL).toBe("claude-opus-5");
  });

  it("declares the report tool as strict with source URL required", () => {
    expect(AI_REPORT_TOOL.strict).toBe(true);
    expect(AI_REPORT_TOOL.input_schema.required).toContain("sourceUrl");
    expect(AI_REPORT_TOOL.input_schema.additionalProperties).toBe(false);
  });

  it("includes the company details it has, and omits the ones it doesn't", () => {
    const full = buildAiUserPrompt({
      name: "Eksempel ApS",
      city: "København",
      website: "https://eksempel.dk",
    });
    expect(full).toContain("Eksempel ApS");
    expect(full).toContain("København");
    expect(full).toContain("https://eksempel.dk");

    const sparse = buildAiUserPrompt({ name: "Eksempel ApS" });
    expect(sparse).toContain("Eksempel ApS");
    expect(sparse).not.toContain("By:");
    expect(sparse).not.toContain("Hjemmeside:");
  });
});
