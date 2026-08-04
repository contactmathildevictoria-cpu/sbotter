import { describe, expect, it } from "vitest";
import {
  buildCvrUpdate,
  isBlockingOutcome,
  namesMatch,
  toDirectors,
  toResult,
  type CvrLookupResult,
} from "@/lib/cvrlookup-core";

/**
 * A board member as the provider actually sends it — including the private
 * `address` that must never reach our database. Typed loosely on purpose:
 * CvrLookupBoardMember deliberately doesn't declare `address`, and these tests
 * exist to prove the extra field is dropped anyway.
 */
function member(overrides: Record<string, unknown>) {
  return {
    name: "Some Person",
    role: "Direktion",
    title: "DIREKTØR",
    address: "Privatvej 12, 2100 København Ø",
    entityType: "PERSON",
    cvr: null,
    ...overrides,
  };
}

describe("toDirectors — privacy filter", () => {
  it("keeps only name and title, dropping the private address", () => {
    const result = toDirectors([member({ name: "Maziar Doustdar", title: "ADM. DIR." })]);

    expect(result).toEqual([{ name: "Maziar Doustdar", title: "ADM. DIR." }]);
    // The strong assertion: no key beyond the two we allow, whatever the input.
    expect(Object.keys(result[0]).sort()).toEqual(["name", "title"]);
    expect(JSON.stringify(result)).not.toContain("Privatvej");
  });

  it("drops every role that is not exactly Direktion", () => {
    expect(
      toDirectors([
        member({ name: "A", role: "Direktion" }),
        member({ name: "B", role: "Bestyrelse" }),
        member({ name: "C", role: "Suppleant" }),
        member({ name: "D", role: "Direktørsuppleant" }),
        member({ name: "E", role: "Stifter" }),
        member({ name: "F", role: null }),
      ]).map((d) => d.name),
    ).toEqual(["A"]);
  });

  it("matches the role case- and whitespace-insensitively", () => {
    expect(toDirectors([member({ name: "A", role: "  direktion " })])).toHaveLength(1);
  });

  it("keeps every director when there is more than one", () => {
    expect(
      toDirectors([
        member({ name: "First", title: "ADM. DIR." }),
        member({ name: "Second", title: "DIREKTØR" }),
        member({ name: "Board", role: "Bestyrelse" }),
      ]),
    ).toEqual([
      { name: "First", title: "ADM. DIR." },
      { name: "Second", title: "DIREKTØR" },
    ]);
  });

  it("nulls a missing or blank title but keeps the person", () => {
    expect(toDirectors([member({ name: "A", title: "  " })])).toEqual([
      { name: "A", title: null },
    ]);
    expect(toDirectors([member({ name: "A", title: undefined })])).toEqual([
      { name: "A", title: null },
    ]);
  });

  it("skips entries with no usable name", () => {
    expect(toDirectors([member({ name: "" }), member({ name: null })])).toEqual([]);
  });

  it("tolerates a missing, null or non-array boardMembers", () => {
    expect(toDirectors(undefined)).toEqual([]);
    expect(toDirectors(null)).toEqual([]);
  });
});

describe("toResult", () => {
  const payload = {
    cvr: "43269070",
    companyName: "codepilots ApS",
    status: "ACTIVE",
    contact: { phone: "70123456", email: "kontakt@example.dk" },
    advertisingProtection: true,
    employeeInfo: { employees: 14, employeeInterval: "10-19" },
    signatureRule: "Selskabet tegnes af en direktør",
    industry: { code: "622000", description: "Computerkonsulentbistand" },
    companyType: { shortDescription: "APS", longDescription: "Anpartsselskab" },
    boardMembers: [member({ name: "Maziar Doustdar", title: "ADM. DIR." })],
  };

  it("maps every documented field", () => {
    expect(toResult(payload)).toEqual({
      cvrNumber: "43269070",
      companyName: "codepilots ApS",
      phone: "70123456",
      email: "kontakt@example.dk",
      advertisingProtection: true,
      employeeCount: 14,
      employeeInterval: "10-19",
      directors: [{ name: "Maziar Doustdar", title: "ADM. DIR." }],
      signatureRule: "Selskabet tegnes af en direktør",
      industryCode: 622000,
      industryText: "Computerkonsulentbistand",
      companyType: "Anpartsselskab",
      isBankrupt: false,
    });
  });

  it("treats absent optional blocks as null rather than throwing", () => {
    const bare = toResult({ cvr: "12345678", companyName: "Bar ApS" });
    expect(bare.phone).toBeNull();
    expect(bare.employeeCount).toBeNull();
    expect(bare.directors).toEqual([]);
    // Null, not false: "the provider didn't say" is not "not protected".
    expect(bare.advertisingProtection).toBeNull();
  });

  it("reads bankruptcy off the normalized status", () => {
    expect(toResult({ ...payload, status: "BANKRUPTCY" }).isBankrupt).toBe(true);
    expect(toResult({ ...payload, status: "DISSOLVED" }).isBankrupt).toBe(false);
  });
});

describe("buildCvrUpdate — coalesce", () => {
  const result: CvrLookupResult = {
    cvrNumber: "43269070",
    companyName: "codepilots ApS",
    phone: "70123456",
    email: "ny@example.dk",
    advertisingProtection: true,
    employeeCount: 14,
    employeeInterval: "10-19",
    directors: [{ name: "Maziar Doustdar", title: "ADM. DIR." }],
    signatureRule: "Selskabet tegnes af en direktør",
    industryCode: 622000,
    industryText: "Computerkonsulentbistand",
    companyType: "Anpartsselskab",
    isBankrupt: false,
  };

  it("fills columns that are null", () => {
    const update = buildCvrUpdate({ phone: null, cvr_phone: null }, result);
    expect(update.phone).toBe("70123456");
    expect(update.cvr_phone).toBe("70123456");
    expect(update.cvr_employee_count).toBe(14);
    expect(update.cvr_directors).toEqual([
      { name: "Maziar Doustdar", title: "ADM. DIR." },
    ]);
  });

  it("never overwrites a column that already has a value", () => {
    const update = buildCvrUpdate(
      {
        phone: "11111111",
        email: "gammel@example.dk",
        contact_person_name: "Eksisterende Person",
        cvr_employee_count: 3,
      },
      result,
    );
    expect(update).not.toHaveProperty("phone");
    expect(update).not.toHaveProperty("email");
    expect(update).not.toHaveProperty("contact_person_name");
    expect(update).not.toHaveProperty("cvr_employee_count");
    // Untouched columns are still filled.
    expect(update.cvr_phone).toBe("70123456");
  });

  it("treats an empty string as an existing value, not a gap", () => {
    // `?? null` semantics would clobber "", so the check is `== null`.
    expect(buildCvrUpdate({ cvr_signature_rule: "" }, result)).not.toHaveProperty(
      "cvr_signature_rule",
    );
  });

  it("does not write nulls from the provider over existing data", () => {
    const sparse = { ...result, phone: null, employeeCount: null };
    const update = buildCvrUpdate({ phone: null, cvr_employee_count: null }, sparse);
    expect(update).not.toHaveProperty("phone");
    expect(update).not.toHaveProperty("cvr_employee_count");
  });

  it("stores null rather than [] when there is no direktion", () => {
    const update = buildCvrUpdate({}, { ...result, directors: [] });
    expect(update).not.toHaveProperty("cvr_directors");
    expect(update).not.toHaveProperty("contact_person_name");
  });

  it("uses the first director as the contact person", () => {
    const update = buildCvrUpdate({}, result);
    expect(update.contact_person_name).toBe("Maziar Doustdar");
  });

  it("flips the not-null booleans on but never off", () => {
    expect(buildCvrUpdate({ is_ad_protected: false }, result).is_ad_protected).toBe(
      true,
    );
    // Already true → nothing to write.
    expect(
      buildCvrUpdate({ is_ad_protected: true }, result),
    ).not.toHaveProperty("is_ad_protected");
    // Provider says not protected → we must not clear an existing true.
    expect(
      buildCvrUpdate(
        { is_ad_protected: true },
        { ...result, advertisingProtection: false },
      ),
    ).not.toHaveProperty("is_ad_protected");
  });

  it("never emits an address key, whatever the directors contain", () => {
    const update = buildCvrUpdate({}, result);
    expect(JSON.stringify(update)).not.toContain("address");
  });
});

describe("isBlockingOutcome", () => {
  it("blocks on quota and auth, not on transient failures", () => {
    expect(isBlockingOutcome("quota")).toBe(true);
    expect(isBlockingOutcome("unauthorized")).toBe(true);
    expect(isBlockingOutcome("forbidden")).toBe(true);
    expect(isBlockingOutcome("rate_limit")).toBe(false);
    expect(isBlockingOutcome("network_error")).toBe(false);
    expect(isBlockingOutcome("not_found")).toBe(false);
  });
});

describe("namesMatch", () => {
  it("ignores company-form suffixes and punctuation", () => {
    expect(namesMatch("Codepilots ApS", "codepilots")).toBe(true);
    expect(namesMatch("Novo Nordisk A/S", "Novo Nordisk")).toBe(true);
  });

  it("rejects unrelated names", () => {
    expect(namesMatch("Codepilots ApS", "Maersk A/S")).toBe(false);
  });
});
