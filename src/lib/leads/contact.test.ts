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
  website_phone: null,
  website_email: null,
  website_contact_person: null,
  website_contact_title: null,
  krak_phone: null,
  krak_contact_person: null,
  krak_contact_title: null,
};

describe("resolveCompanyContact", () => {
  it("prefers CVR over website and Krak", () => {
    const c = resolveCompanyContact({
      ...EMPTY,
      phone: "11111111",
      website_phone: "22222222",
      krak_phone: "33333333",
    });
    expect(c.phone).toBe("11111111");
    expect(c.phoneSource).toBe("cvr");
  });

  it("falls back to website when CVR is empty", () => {
    const c = resolveCompanyContact({
      ...EMPTY,
      website_phone: "22222222",
      krak_phone: "33333333",
    });
    expect(c.phone).toBe("22222222");
    expect(c.phoneSource).toBe("website");
  });

  it("falls back to Krak only when CVR and website are both empty", () => {
    const c = resolveCompanyContact({ ...EMPTY, krak_phone: "33333333" });
    expect(c.phone).toBe("33333333");
    expect(c.phoneSource).toBe("krak");
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
      krak_contact_person: "Anna And",
      krak_contact_title: "Direktør",
    });
    expect(fromWebsite.contactName).toBe("Jens Jensen");
    expect(fromWebsite.contactTitle).toBe("CTO");

    const fromKrak = resolveCompanyContact({
      ...EMPTY,
      krak_contact_person: "Anna And",
      krak_contact_title: "Direktør",
    });
    expect(fromKrak.contactName).toBe("Anna And");
    expect(fromKrak.contactTitle).toBe("Direktør");
  });

  it("never sources an email from Krak", () => {
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

  it("accepts a partial select() result", () => {
    // Only two of the ten fields present — the type and the cascade must cope.
    const c = resolveCompanyContact({ krak_phone: "33333333" });
    expect(c.phone).toBe("33333333");
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
