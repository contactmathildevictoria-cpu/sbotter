// Canonical shape every Sbotter Actor emits to the ingest webhook. It is the
// NESTED shape validated by the app's `jobnetItemSchema`
// (src/lib/ingest/normalize.ts) — keep them in sync. The trailing
// employmentType / contactEmail / contactPhone fields are optional: only some
// sources provide them (e.g. Jobdanmark). They are preserved on the posting's
// `raw` jsonb server-side; they are NOT mapped onto company contact columns.
//
// `company.website` doubles as the "companyUrl" (the hiring company's own site,
// when the source exposes it) — the normalizer prefers it over deriving a site
// from the posting URL.
export interface ScrapedListing {
  externalId: string;
  title: string;
  description: string | null;
  // Leave null to let the server-side normalizer infer a category from the title.
  category: string | null;
  url: string;
  postedAt: string | null;
  expiresAt: string | null;
  employmentType?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  location: {
    city: string | null;
    region: string | null;
    country: string | null;
  };
  company: {
    name: string;
    cvr: string | null;
    website: string | null;
    description: string | null;
  };
}

// Input company the Krak enricher Actor looks up (sent by Sbotter in the run
// input). `id` is the Sbotter company UUID — echoed back as `companyId` so the
// webhook can match results to rows.
export interface KrakCompanyInput {
  id: string;
  name: string;
  city: string | null;
}

// One per-company result the Krak enricher Actor posts back. The Actor only sets
// `matched: true` when the Krak listing clearly matches the requested company;
// Sbotter trusts phone/contact data only then (and only fills empty fields).
export interface KrakLookupResult {
  companyId: string;
  matched: boolean;
  phone: string | null;
  contactPerson: string | null;
  contactTitle: string | null;
  krakUrl: string | null;
}
