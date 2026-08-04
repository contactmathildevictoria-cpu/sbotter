/**
 * Resolves a company's contact details across the three enrichment pipelines.
 *
 * PURE — no I/O, no `server-only`. Importable from RSCs, client components,
 * route handlers and tests alike.
 *
 * The three pipelines write into disjoint column sets and never overwrite each
 * other: CVR owns `phone` / `email` / `contact_person_name`, the website
 * scraper owns `website_*`, Krak owns `krak_*`. So the per-field cascade below
 * is what turns three partial records into one contact.
 *
 * Order is CVR → website → Krak → AI. Note that docs/fase-1-liste-motor-og-crm.md
 * once described it as CVR → Krak → website; the shipped behaviour has always
 * been website first (the scraper usually finds a direct contact where Krak
 * only has the switchboard), and changing it would silently alter what every
 * existing user sees in the leads table and the CSV export.
 *
 * "ai" is last and is the one source that is not trusted on its own: it comes
 * from an LLM with web search, so it always carries `phoneSourceUrl` and must
 * always be rendered with a visible marker linking to that source. An AI number
 * must never appear unmarked anywhere. See docs/ai-phone-layer.md.
 */

import type { CvrDirector } from "@/types/database";

export type ContactSource = "cvr" | "website" | "krak" | "ai";

/**
 * Structural, all-optional shape so a partial `select()` satisfies it just as
 * well as a full `companies` row.
 */
export type CompanyContactFields = {
  phone?: string | null;
  email?: string | null;
  contact_person_name?: string | null;
  /**
   * Direktion from CVR, name + title only. Preferred over
   * `contact_person_name` when present because it carries the person's title
   * ("ADM. DIR."), which the plain name column cannot.
   */
  cvr_directors?: CvrDirector[] | null;
  website_phone?: string | null;
  website_email?: string | null;
  website_contact_person?: string | null;
  website_contact_title?: string | null;
  krak_phone?: string | null;
  krak_contact_person?: string | null;
  krak_contact_title?: string | null;
  ai_phone?: string | null;
  ai_contact_person?: string | null;
  ai_source_url?: string | null;
};

export type CompanyContact = {
  phone: string | null;
  phoneSource: ContactSource | null;
  /**
   * Where an AI-sourced phone was found. Non-null exactly when
   * `phoneSource === "ai"` — the AI layer refuses to store a number without
   * one — so it is always available to link the required source marker.
   */
  phoneSourceUrl: string | null;
  email: string | null;
  /** Only CVR and the website scraper produce emails. */
  emailSource: Extract<ContactSource, "cvr" | "website"> | null;
  contactName: string | null;
  /**
   * Null unless the source supplied one. For CVR that means the name came from
   * `cvr_directors` (which carries "ADM. DIR." and the like) rather than from
   * the older bare `contact_person_name`.
   */
  contactTitle: string | null;
  contactSource: ContactSource | null;
  /** Same URL, for a contact name that came from the AI layer. */
  contactSourceUrl: string | null;
  hasAny: boolean;
};

export function resolveCompanyContact(
  company: CompanyContactFields,
): CompanyContact {
  // An AI phone is only usable if it carries its source URL. Guarding here as
  // well as at write time means a row that somehow lost its provenance is
  // treated as having no AI phone at all, rather than rendering unmarked.
  const aiSourceUrl = company.ai_source_url ?? null;
  const aiPhone = aiSourceUrl ? (company.ai_phone ?? null) : null;
  const aiContactPerson = aiSourceUrl ? (company.ai_contact_person ?? null) : null;

  const phone =
    company.phone ?? company.website_phone ?? company.krak_phone ?? aiPhone ?? null;
  const phoneSource: ContactSource | null = company.phone
    ? "cvr"
    : company.website_phone
      ? "website"
      : company.krak_phone
        ? "krak"
        : aiPhone
          ? "ai"
          : null;

  const email = company.email ?? company.website_email ?? null;
  const emailSource: CompanyContact["emailSource"] = company.email
    ? "cvr"
    : company.website_email
      ? "website"
      : null;

  // The first person on the direktion, when CVR gave us one. Ranked ahead of
  // contact_person_name — it is the same source, but it carries a title.
  const director = company.cvr_directors?.[0] ?? null;
  const cvrContactName = director?.name ?? company.contact_person_name ?? null;

  const contactName =
    cvrContactName ??
    company.website_contact_person ??
    company.krak_contact_person ??
    aiContactPerson ??
    null;
  const contactSource: ContactSource | null = cvrContactName
    ? "cvr"
    : company.website_contact_person
      ? "website"
      : company.krak_contact_person
        ? "krak"
        : aiContactPerson
          ? "ai"
          : null;
  // The title has to follow whichever source supplied the name, or a Krak
  // title could end up captioning a website-scraped person. CVR only has a
  // title when the name came from the direktion; the AI layer stores none.
  const contactTitle =
    contactSource === "cvr"
      ? (director?.name === contactName ? (director?.title ?? null) : null)
      : contactSource === "website"
        ? (company.website_contact_title ?? null)
        : contactSource === "krak"
          ? (company.krak_contact_title ?? null)
          : null;

  return {
    phone,
    phoneSource,
    phoneSourceUrl: phoneSource === "ai" ? aiSourceUrl : null,
    email,
    emailSource,
    contactName,
    contactTitle,
    contactSource,
    contactSourceUrl: contactSource === "ai" ? aiSourceUrl : null,
    hasAny: Boolean(contactName || phone || email),
  };
}

/** Danish numbers come from CVR without a country code; prefix +45 for tel: links. */
export function telHref(phone: string): string {
  const trimmed = phone.replace(/\s+/g, "");
  return trimmed.startsWith("+") ? trimmed : `+45${trimmed}`;
}

/** `website` may be stored as a bare domain; ensure links have a scheme. */
export function websiteHref(url: string): string {
  return /^https?:\/\//i.test(url) ? url : `https://${url}`;
}

/** Bare hostname for a compact, readable website link. */
export function displayHost(url: string): string {
  try {
    return new URL(websiteHref(url)).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
