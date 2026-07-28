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
 * Order is CVR → website → Krak. Note that docs/fase-1-liste-motor-og-crm.md
 * once described it as CVR → Krak → website; the shipped behaviour has always
 * been website first (the scraper usually finds a direct contact where Krak
 * only has the switchboard), and changing it would silently alter what every
 * existing user sees in the leads table and the CSV export.
 */

export type ContactSource = "cvr" | "website" | "krak";

/**
 * Structural, all-optional shape so a partial `select()` satisfies it just as
 * well as a full `companies` row.
 */
export type CompanyContactFields = {
  phone?: string | null;
  email?: string | null;
  contact_person_name?: string | null;
  website_phone?: string | null;
  website_email?: string | null;
  website_contact_person?: string | null;
  website_contact_title?: string | null;
  krak_phone?: string | null;
  krak_contact_person?: string | null;
  krak_contact_title?: string | null;
};

export type CompanyContact = {
  phone: string | null;
  phoneSource: ContactSource | null;
  email: string | null;
  /** Krak has no email column, so this is never "krak". */
  emailSource: Exclude<ContactSource, "krak"> | null;
  contactName: string | null;
  /** CVR carries no job title, so this is null when the name came from CVR. */
  contactTitle: string | null;
  contactSource: ContactSource | null;
  hasAny: boolean;
};

export function resolveCompanyContact(
  company: CompanyContactFields,
): CompanyContact {
  const phone =
    company.phone ?? company.website_phone ?? company.krak_phone ?? null;
  const phoneSource: ContactSource | null = company.phone
    ? "cvr"
    : company.website_phone
      ? "website"
      : company.krak_phone
        ? "krak"
        : null;

  const email = company.email ?? company.website_email ?? null;
  const emailSource: CompanyContact["emailSource"] = company.email
    ? "cvr"
    : company.website_email
      ? "website"
      : null;

  const contactName =
    company.contact_person_name ??
    company.website_contact_person ??
    company.krak_contact_person ??
    null;
  const contactSource: ContactSource | null = company.contact_person_name
    ? "cvr"
    : company.website_contact_person
      ? "website"
      : company.krak_contact_person
        ? "krak"
        : null;
  // The title has to follow whichever source supplied the name, or a Krak
  // title could end up captioning a website-scraped person.
  const contactTitle =
    contactSource === "website"
      ? (company.website_contact_title ?? null)
      : contactSource === "krak"
        ? (company.krak_contact_title ?? null)
        : null;

  return {
    phone,
    phoneSource,
    email,
    emailSource,
    contactName,
    contactTitle,
    contactSource,
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
