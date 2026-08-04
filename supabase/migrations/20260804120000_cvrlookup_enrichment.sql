-- CVR enrichment, second provider: cvrlookup.dk replaces cvrapi.dk.
--
-- cvrapi.dk capped us at 50 lookups/day/IP. cvrlookup.dk gives 25.000/month with
-- a batch endpoint and a wider field set, so this migration adds the columns for
-- the fields the old provider never returned.
--
-- Purely additive. Every existing cvr_* column stays exactly as it is and no
-- data is deleted — the old columns (phone, email, contact_person_name,
-- cvr_industry_code, cvr_industry_text, cvr_company_type, is_ad_protected,
-- is_bankrupt) are still written by the new client so the leads UI, the contact
-- cascade and the CSV export keep working unchanged.

alter table public.companies
  -- Contact details, kept in their own columns alongside the shared
  -- phone/email that the contact cascade reads.
  add column if not exists cvr_phone text,
  add column if not exists cvr_email text,
  -- Reklamebeskyttelse. Nullable on purpose: null means "not looked up yet",
  -- which the existing not-null is_ad_protected boolean cannot express.
  add column if not exists cvr_advertising_protection boolean,
  -- Employment, as reported to CVR. The exact count is often withheld while the
  -- interval ("10-19") is still published, so both are stored.
  add column if not exists cvr_employee_count integer,
  add column if not exists cvr_employee_interval text,
  -- Direktion only, and only { name, title } per person.
  --
  -- PRIVACY: the provider returns boardMembers[] with a private home address on
  -- each person. That address must never reach this column. The mapping layer in
  -- src/lib/cvrlookup.ts builds each entry field-by-field from an allowlist, so
  -- the address is dropped before it is ever written or logged. Bestyrelse and
  -- suppleanter are filtered out entirely.
  -- Shape: [{"name": "Maziar Doustdar", "title": "ADM. DIR."}]
  add column if not exists cvr_directors jsonb,
  -- Tegningsregel.
  add column if not exists cvr_signature_rule text,
  -- When we last called the provider for this company, successful or not. Drives
  -- the "don't look the same company up again and again" selection, and is
  -- distinct from cvr_enriched_at, which only moves on a successful enrichment.
  add column if not exists cvr_last_fetched_at timestamptz;

-- The enrichment selection is "never fetched, or fetched longer ago than the
-- refresh window", ordered by age. A nulls-first index serves exactly that.
create index if not exists companies_cvr_last_fetched_at_idx
  on public.companies (cvr_last_fetched_at nulls first);

comment on column public.companies.cvr_directors is
  'Direktion only, {name, title} per person. Private addresses from the '
  'provider are stripped in the mapping layer and must never be stored here.';

comment on column public.companies.cvr_advertising_protection is
  'Reklamebeskyttet per CVR. Null = not yet looked up.';

comment on column public.companies.cvr_last_fetched_at is
  'Last provider call for this company (success or not), used to avoid '
  're-fetching the same companies every run.';
