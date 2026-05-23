-- CVR enrichment: contact data pulled from the Danish CVR registry (cvrapi.dk)
-- for each ingested company. Columns are nullable; enrichment is best-effort and
-- runs asynchronously after ingest, so leads exist with or without contact data.

alter table public.companies
  -- Contact info from CVR
  add column if not exists phone text,
  add column if not exists email text,
  -- Owner/director (first entry from the CVR owners array)
  add column if not exists contact_person_name text,
  -- CVR metadata
  add column if not exists cvr_industry_code integer,
  add column if not exists cvr_industry_text text,
  add column if not exists cvr_company_type text,
  add column if not exists is_ad_protected boolean not null default false,
  add column if not exists is_bankrupt boolean not null default false,
  -- Enrichment tracking
  add column if not exists cvr_enriched_at timestamptz,
  add column if not exists cvr_enrichment_status text not null default 'pending';

-- Status is a small closed set. Added separately so re-running the migration
-- doesn't error if the column already exists from a partial run.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'companies_cvr_enrichment_status_check'
  ) then
    alter table public.companies
      add constraint companies_cvr_enrichment_status_check
      check (cvr_enrichment_status in ('pending', 'enriched', 'failed', 'no_match', 'skipped'));
  end if;
end $$;

-- Lets a future background job find rows still needing enrichment cheaply.
create index if not exists companies_cvr_enrichment_status_idx
  on public.companies (cvr_enrichment_status)
  where cvr_enrichment_status = 'pending';
