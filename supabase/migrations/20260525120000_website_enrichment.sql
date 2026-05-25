-- Website-scraper enrichment: a fallback for companies whose CVR record has no
-- phone/email. When that happens we visit the company's own website (the
-- `website` column) and try to extract contact info from the homepage and
-- common contact/about subpages. Results are kept in dedicated website_* columns
-- so the CVR data (always preferred) is never overwritten — the UI falls back to
-- these only when the CVR field is null. See src/lib/website-scraper.ts.

alter table public.companies
  -- Best contact phone/email scraped from the site (already normalized)
  add column if not exists website_phone text,
  add column if not exists website_email text,
  -- Best contact person discovered on the site (name + their title, if any)
  add column if not exists website_contact_person text,
  add column if not exists website_contact_title text,
  -- Scrape tracking
  add column if not exists website_scraped_at timestamptz,
  add column if not exists website_scrape_status text not null default 'pending';

-- Status is a small closed set. Added separately so re-running the migration
-- doesn't error if the column already exists from a partial run.
--   pending    — not yet attempted
--   scraped    — finished and stored at least some data
--   failed     — unreachable / blocked / no useful data (retryable)
--   no_website — the company has no website URL to scrape
--   skipped    — deliberately not scraped (e.g. CVR already had a phone)
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'companies_website_scrape_status_check'
  ) then
    alter table public.companies
      add constraint companies_website_scrape_status_check
      check (website_scrape_status in ('pending', 'scraped', 'failed', 'no_website', 'skipped'));
  end if;
end $$;

-- Lets the website-scraping batch pass find rows still needing a scrape cheaply.
create index if not exists companies_website_scrape_status_idx
  on public.companies (website_scrape_status)
  where website_scrape_status = 'pending';
