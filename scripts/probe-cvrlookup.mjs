/**
 * Confirms the cvrlookup.dk response shape against the live API before we trust
 * the enrichment pipeline with it.
 *
 * The field names in src/lib/cvrlookup.ts were taken from the provider's
 * published OpenAPI document (https://cvrlookup.dk/openapi.json), which is
 * authoritative — but a spec can lag the deployed API, and two things it cannot
 * tell us are whether YOUR key's plan allows the batch endpoint (Basic/Pro only,
 * Free answers 403) and what your real per-minute limit is. This settles both,
 * plus every field the mapping reads.
 *
 * Costs ~4 quota units. Run:
 *   set -a; . ./.env.local; set +a; node scripts/probe-cvrlookup.mjs
 *
 * PRIVACY: boardMembers carry private home addresses. This script NEVER prints
 * an address — it prints only whether the field was present, so you can verify
 * the mapping strips it. Keep it that way if you extend this file.
 */

const API_BASE = "https://cvrlookup.dk/api/v1";
const KEY = process.env.CVRLOOKUP_API_KEY;

if (!KEY) {
  console.error("CVRLOOKUP_API_KEY is not set — nothing to probe.");
  process.exit(1);
}

// Two well-known active Danish companies. Override with argv to probe your own.
const SAMPLE_CVRS = process.argv.slice(2);
const CVRS = SAMPLE_CVRS.length ? SAMPLE_CVRS : ["43269070", "25052943"];

async function call(path, init) {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${KEY}`,
      Accept: "application/json",
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
    },
  });
  let json;
  try {
    json = await res.json();
  } catch {
    json = { parseError: await res.text().catch(() => "<unreadable>") };
  }
  return { status: res.status, json };
}

const ok = (b) => (b ? "OK  " : "MISS");

// --- 1. Plan, quota and the real per-minute limit ---------------------------
console.log("=== GET /usage (free, does not count against quota) ===");
{
  const { status, json } = await call("/usage");
  console.log(`HTTP ${status}`);
  if (json?.success) {
    const q = json.data?.quota ?? {};
    console.log(
      `  monthly: ${q.monthly?.used ?? "?"}/${q.monthly?.limit ?? "?"} used, ` +
        `${q.monthly?.remaining ?? "?"} remaining`,
    );
    console.log(
      `  per-minute limit: ${q.rateLimit?.perMinute ?? "?"}  ` +
        `(src/lib/cvrlookup.ts assumes RATE_LIMIT_PER_MINUTE = 20)`,
    );
  } else {
    console.log(" ", JSON.stringify(json));
  }
}

// --- 2. Single lookup: every field the mapping reads -------------------------
console.log(`\n=== GET /company/${CVRS[0]} ===`);
let sample = null;
{
  const { status, json } = await call(`/company/${CVRS[0]}`);
  console.log(`HTTP ${status}, success=${json?.success}`);
  if (!json?.success) {
    console.log(" ", JSON.stringify(json));
  } else {
    sample = json.data;
    const d = sample;
    console.log("  field                        status  value");
    const rows = [
      ["contact.phone", d.contact?.phone],
      ["contact.email", d.contact?.email],
      ["advertisingProtection", d.advertisingProtection],
      ["employeeInfo.employees", d.employeeInfo?.employees],
      ["employeeInfo.employeeInterval", d.employeeInfo?.employeeInterval],
      ["signatureRule", d.signatureRule],
      ["industry.code", d.industry?.code],
      ["industry.description", d.industry?.description],
      ["companyType.longDescription", d.companyType?.longDescription],
      ["status", d.status],
    ];
    for (const [name, value] of rows) {
      const present = value !== undefined;
      const shown =
        typeof value === "string" && value.length > 40
          ? `${value.slice(0, 40)}…`
          : String(value);
      console.log(`  ${name.padEnd(28)} ${ok(present)}    ${shown}`);
    }
  }
}

// --- 3. boardMembers: roles present, and the address we must strip -----------
console.log("\n=== boardMembers (addresses redacted on purpose) ===");
if (sample) {
  const members = sample.boardMembers ?? [];
  console.log(`  ${members.length} member(s)`);
  const roles = [...new Set(members.map((m) => m?.role ?? "<no role>"))];
  console.log(`  distinct roles: ${JSON.stringify(roles)}`);
  console.log(
    `  any member carrying an address field: ` +
      `${members.some((m) => m?.address != null)} ` +
      `(this is exactly what toDirectors() must drop)`,
  );

  // Mirror of toDirectors() in src/lib/cvrlookup.ts — same allowlist rebuild.
  const directors = members
    .filter((m) => m?.role?.trim().toLowerCase() === "direktion")
    .map((m) => ({ name: m.name?.trim(), title: m.title?.trim() ?? null }))
    .filter((m) => m.name);
  console.log(`  → cvr_directors would be: ${JSON.stringify(directors)}`);
  const leaks = directors.filter((d) => Object.keys(d).some((k) => k === "address"));
  console.log(`  address keys leaking into the mapped value: ${leaks.length}`);
} else {
  console.log("  skipped — single lookup failed");
}

// --- 4. Batch: the request body shape and plan gating ------------------------
console.log(`\n=== POST /company/batch  body={"cvrs":${JSON.stringify(CVRS)}} ===`);
{
  const { status, json } = await call("/company/batch", {
    method: "POST",
    body: JSON.stringify({ cvrs: CVRS }),
  });
  console.log(`HTTP ${status}, success=${json?.success}`);
  if (!json?.success) {
    console.log(" ", JSON.stringify(json));
    if (status === 403) {
      console.log(
        "  → Batch needs the provider's Basic or Pro plan. The enrichment pass\n" +
          "    falls back to single lookups automatically, so this is survivable.",
      );
    }
  } else {
    const d = json.data;
    console.log(
      `  requested=${d.requested} returned=${d.returned} errors=${d.errors} ` +
        `stoppedReason=${d.stoppedReason} quotaExhausted=${d.quotaExhausted} took=${d.took}ms`,
    );
    for (const r of d.results ?? []) {
      console.log(
        `  ${r.cvr}: found=${r.found}${r.error ? " error=true" : ""}` +
          (r.company ? ` name="${r.company.companyName}"` : ""),
      );
    }
    console.log(
      "  → results[].company uses the same schema as the single lookup above.",
    );
  }
}

console.log("\nDone.");
