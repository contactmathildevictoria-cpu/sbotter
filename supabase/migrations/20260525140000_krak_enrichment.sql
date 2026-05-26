-- Krak.dk enrichment: phone + contact person from the Danish phone directory
-- (krak.dk), which carries telco subscriber numbers the CVR registry lacks. A
-- best-effort fallback for companies whose CVR record has no phone. Mirrors the
-- CVR enrichment columns (20260522120000). Results live in dedicated krak_*
-- columns so the CVR data (always preferred) is never overwritten — the UI falls
-- back to these only when the CVR field is null. Populated asynchronously by an
-- Apify Actor; see apify-actors/krak-enricher/ and src/lib/krak.ts.

alter table public.companies
  -- Best phone + contact person discovered on Krak (already normalized)
  add column if not exists krak_phone text,
  add column if not exists krak_contact_person text,
  add column if not exists krak_contact_title text,
  -- The Krak listing URL the data came from (provenance)
  add column if not exists krak_url text,
  -- Enrichment tracking
  add column if not exists krak_enriched_at timestamptz,
  add column if not exists krak_enrichment_status text not null default 'pending';

-- Status is a small closed set. Added separately so re-running the migration
-- doesn't error if the column already exists from a partial run.
--   pending   — not yet attempted
--   queued    — sent to a Krak Actor run; awaiting the result webhook
--   enriched  — finished and stored a phone
--   no_match  — no clear company match on Krak (definitive)
--   failed    — blocked / unreachable / error (retryable)
--   skipped   — deliberately not looked up
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'companies_krak_enrichment_status_check'
  ) then
    alter table public.companies
      add constraint companies_krak_enrichment_status_check
      check (krak_enrichment_status in
        ('pending', 'queued', 'enriched', 'failed', 'no_match', 'skipped'));
  end if;
end $$;

-- Lets the "Find phone numbers" batch find rows still needing a Krak lookup cheaply.
create index if not exists companies_krak_enrichment_status_idx
  on public.companies (krak_enrichment_status)
  where krak_enrichment_status = 'pending';
