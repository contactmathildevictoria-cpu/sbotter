import { describe, expect, it } from "vitest";
import {
  displayHost,
  resolveCompanyContact,
  telHref,
  websiteHref,
} from "@/lib/leads/contact";

const EMPTY = {
  phone: null,
  email: null,
  contact_person_name: null,
  cvr_directors: null,
  website_phone: null,
  website_email: null,
  website_contact_person: null,
  website_contact_title: null,
  ai_phone: null,
  ai_contact_person: null,
  ai_source_url: null,
};

const AI_SOURCE = "https://www.proff.dk/firma/eksempel-aps/12345678";

describe("resolveCompanyContact — direktion from CVR", () => {
  it("shows the director's name and title", () => {
    const c = resolveCompanyContact({
      ...EMPTY,
      cvr_directors: [{ name: "Maziar Doustdar", title: "ADM. DIR." }],
    });
    expect(c.contactName).toBe("Maziar Doustdar");
    expect(c.contactTitle).toBe("ADM. DIR.");
    expect(c.contactSource).toBe("cvr");
    expect(c.hasAny).toBe(true);
  });

  it("prefers the director over the older bare contact_person_name", () => {
    const c = resolveCompanyContact({
      ...EMPTY,
      contact_person_name: "Gammelt Navn",
      cvr_directors: [{ name: "Maziar Doustdar", title: "ADM. DIR." }],
    });
    expect(c.contactName).toBe("Maziar Doustdar");
    expect(c.contactTitle).toBe("ADM. DIR.");
  });

  it("falls back to contact_person_name when there is no direktion", () => {
    const c = resolveCompanyContact({
      ...EMPTY,
      contact_person_name: "Mette Hansen",
      cvr_directors: [],
    });
    expect(c.contactName).toBe("Mette Hansen");
    expect(c.contactSource).toBe("cvr");
    // The bare column carries no title.
    expect(c.contactTitle).toBeNull();
  });

  it("still outranks website contacts", () => {
    const c = resolveCompanyContact({
      ...EMPTY,
      cvr_directors: [{ name: "Direktør", title: "DIREKTØR" }],
      website_contact_person: "Web Person",
    });
    expect(c.contactName).toBe("Direktør");
    expect(c.contactSource).toBe("cvr");
  });

  it("uses a website contact when the direktion is empty", () => {
    const c = resolveCompanyContact({
      ...EMPTY,
      cvr_directors: [],
      website_contact_person: "Web Person",
      website_contact_title: "Salgschef",
    });
    expect(c.contactName).toBe("Web Person");
    expect(c.contactTitle).toBe("Salgschef");
    expect(c.contactSource).toBe("website");
  });

  it("handles a director with no title", () => {
    const c = resolveCompanyContact({
      ...EMPTY,
      cvr_directors: [{ name: "Uden Titel", title: null }],
    });
    expect(c.contactName).toBe("Uden Titel");
    expect(c.contactTitle).toBeNull();
  });
});

describe("resolveCompanyContact", () => {
  it("prefers CVR over website", () => {
    const c = resolveCompanyContact({
      ...EMPTY,
      phone: "11111111",
      website_phone: "22222222",
    });
    expect(c.phone).toBe("11111111");
    expect(c.phoneSource).toBe("cvr");
  });

  it("falls back to website when CVR is empty", () => {
    const c = resolveCompanyContact({
      ...EMPTY,
      website_phone: "22222222",
    });
    expect(c.phone).toBe("22222222");
    expect(c.phoneSource).toBe("website");
  });

  it("has no title when the contact name came from CVR", () => {
    const c = resolveCompanyContact({
      ...EMPTY,
      contact_person_name: "Mette Hansen",
      // Present but must be ignored — they belong to a different person.
      website_contact_person: "Jens Jensen",
      website_contact_title: "CTO",
    });
    expect(c.contactName).toBe("Mette Hansen");
    expect(c.contactSource).toBe("cvr");
    expect(c.contactTitle).toBeNull();
  });

  it("takes the title from whichever source supplied the name", () => {
    const fromWebsite = resolveCompanyContact({
      ...EMPTY,
      website_contact_person: "Jens Jensen",
      website_contact_title: "CTO",
    });
    expect(fromWebsite.contactName).toBe("Jens Jensen");
    expect(fromWebsite.contactTitle).toBe("CTO");
  });

  it("sources an email from CVR or the website only", () => {
    const c = resolveCompanyContact({
      ...EMPTY,
      website_email: "kontakt@eksempel.dk",
    });
    expect(c.email).toBe("kontakt@eksempel.dk");
    expect(c.emailSource).toBe("website");
  });

  it("reports hasAny=false for a company with no contact data at all", () => {
    const c = resolveCompanyContact(EMPTY);
    expect(c.hasAny).toBe(false);
    expect(c.phone).toBeNull();
    expect(c.contactName).toBeNull();
    expect(c.phoneSource).toBeNull();
  });

  it("falls back to AI only when both trusted layers are empty", () => {
    const c = resolveCompanyContact({
      ...EMPTY,
      ai_phone: "70208060",
      ai_source_url: AI_SOURCE,
    });
    expect(c.phone).toBe("70208060");
    expect(c.phoneSource).toBe("ai");
    expect(c.phoneSourceUrl).toBe(AI_SOURCE);
  });

  it("never lets an AI phone outrank a trusted one", () => {
    for (const trusted of ["phone", "website_phone"] as const) {
      const c = resolveCompanyContact({
        ...EMPTY,
        [trusted]: "11223344",
        ai_phone: "70208060",
        ai_source_url: AI_SOURCE,
      });
      expect(c.phone).toBe("11223344");
      expect(c.phoneSource).not.toBe("ai");
      // No AI value in play means no source marker to render.
      expect(c.phoneSourceUrl).toBeNull();
    }
  });

  it("ignores an AI phone that lost its source URL", () => {
    // The invariant the whole layer rests on: an unsourced AI number is not
    // shown at all, rather than shown unmarked.
    const c = resolveCompanyContact({ ...EMPTY, ai_phone: "70208060" });
    expect(c.phone).toBeNull();
    expect(c.phoneSource).toBeNull();
    expect(c.phoneSourceUrl).toBeNull();
    expect(c.hasAny).toBe(false);
  });

  it("always pairs an AI-sourced value with a URL to mark it", () => {
    // Property: phoneSource === "ai" implies a non-null phoneSourceUrl, and
    // vice versa. This is what makes "never unmarked" enforceable in the UI.
    const cases = [
      EMPTY,
      { ...EMPTY, ai_phone: "70208060", ai_source_url: AI_SOURCE },
      { ...EMPTY, ai_phone: "70208060" },
      { ...EMPTY, phone: "11223344", ai_phone: "70208060", ai_source_url: AI_SOURCE },
      { ...EMPTY, ai_contact_person: "Mette Hansen", ai_source_url: AI_SOURCE },
    ];
    for (const input of cases) {
      const c = resolveCompanyContact(input);
      expect(c.phoneSourceUrl !== null).toBe(c.phoneSource === "ai");
      expect(c.contactSourceUrl !== null).toBe(c.contactSource === "ai");
    }
  });

  it("uses an AI contact person only as the last fallback, with its source", () => {
    const fromAi = resolveCompanyContact({
      ...EMPTY,
      ai_contact_person: "Mette Hansen",
      ai_source_url: AI_SOURCE,
    });
    expect(fromAi.contactName).toBe("Mette Hansen");
    expect(fromAi.contactSource).toBe("ai");
    expect(fromAi.contactSourceUrl).toBe(AI_SOURCE);
    // The AI layer stores no job title.
    expect(fromAi.contactTitle).toBeNull();

    const websiteWins = resolveCompanyContact({
      ...EMPTY,
      website_contact_person: "Anna And",
      website_contact_title: "Direktør",
      ai_contact_person: "Mette Hansen",
      ai_source_url: AI_SOURCE,
    });
    expect(websiteWins.contactName).toBe("Anna And");
    expect(websiteWins.contactSource).toBe("website");
    expect(websiteWins.contactSourceUrl).toBeNull();
  });

  it("accepts a partial select() result", () => {
    // Only one of the many fields present — the type and the cascade must cope.
    const c = resolveCompanyContact({ website_phone: "22222222" });
    expect(c.phone).toBe("22222222");
    expect(c.hasAny).toBe(true);
  });
});

describe("telHref", () => {
  it("prefixes bare Danish numbers with +45 and strips whitespace", () => {
    expect(telHref("12 34 56 78")).toBe("+4512345678");
    expect(telHref("12345678")).toBe("+4512345678");
  });

  it("leaves an already-international number alone", () => {
    expect(telHref("+46 8 123 456")).toBe("+468123456");
  });
});

describe("websiteHref / displayHost", () => {
  it("adds a scheme to bare domains but keeps an existing one", () => {
    expect(websiteHref("eksempel.dk")).toBe("https://eksempel.dk");
    expect(websiteHref("http://eksempel.dk")).toBe("http://eksempel.dk");
  });

  it("shows a bare hostname without www", () => {
    expect(displayHost("https://www.eksempel.dk/kontakt")).toBe("eksempel.dk");
    expect(displayHost("eksempel.dk")).toBe("eksempel.dk");
  });

  it("returns the input unchanged when it cannot be parsed", () => {
    expect(displayHost("ikke en url")).toBe("ikke en url");
  });
});
