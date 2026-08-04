-- Remove the Krak.dk enrichment layer (added in 20260525140000).
--
-- The Apify Actor behind it has been deleted. It never produced a single match
-- (300 lookups, 0 results) and it had no webhook wired up in Apify, so no
-- result could ever have reached this database. Every krak_* column is empty
-- and krak_enrichment_status is 'pending' on every row.
--
-- Verify that before running this, from the SQL editor:
--
--   select
--     count(*) as companies,
--     count(krak_phone)           as with_phone,
--     count(krak_contact_person)  as with_contact_person,
--     count(krak_contact_title)   as with_contact_title,
--     count(krak_url)             as with_url,
--     count(krak_enriched_at)     as with_enriched_at,
--     count(*) filter (where krak_enrichment_status <> 'pending') as non_pending
--   from public.companies;
--
-- Every column but `companies` must come back 0. If any is non-zero, export
-- those rows before dropping — this migration is not reversible.
--
-- Dropping the columns also drops the check constraint
-- companies_krak_enrichment_status_check and the partial index
-- companies_krak_enrichment_status_idx that depended on them.

alter table public.companies
  drop column if exists krak_phone,
  drop column if exists krak_contact_person,
  drop column if exists krak_contact_title,
  drop column if exists krak_url,
  drop column if exists krak_enriched_at,
  drop column if exists krak_enrichment_status;
