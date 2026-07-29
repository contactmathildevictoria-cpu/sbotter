-- AI phone enrichment: the fourth and last contact layer, for the long tail of
-- companies where CVR, Krak AND the website scraper all came up empty. An LLM
-- with web search looks the number up (Proff, LinkedIn, local directories) and
-- must return the exact source URL it found it on.
--
-- The provenance column is the point. An LLM can invent a plausible-looking
-- phone number, so a result without a source URL is discarded and never stored;
-- what is stored is always shown in the UI with a source icon linking to
-- ai_source_url, so a seller can check it themselves. Verification is by
-- provenance plus a human, not by an automated fetch-and-confirm step.
--
-- Kept in dedicated ai_* columns so the three trusted layers are never
-- overwritten — the UI falls back to these only when all of them are null.
-- See src/lib/ai-phone.ts.

alter table public.companies
  -- Phone found by the model (normalized through normalizePhone before storing)
  add column if not exists ai_phone text,
  add column if not exists ai_contact_person text,
  -- Provenance: the page the number was found on. Never null when ai_phone is
  -- set — the apply step refuses to store a number without it.
  add column if not exists ai_source_url text,
  -- Lookup tracking
  add column if not exists ai_enriched_at timestamptz,
  add column if not exists ai_enrichment_status text not null default 'pending';

-- Status is a small closed set. Added separately so re-running the migration
-- doesn't error if the column already exists from a partial run.
--   pending   — not yet attempted
--   enriched  — found a number with a source URL
--   no_match  — no trustworthy number found (do not retry every run)
--   failed    — error/timeout, retryable
--   skipped   — a trusted layer already had a phone
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'companies_ai_enrichment_status_check'
  ) then
    alter table public.companies
      add constraint companies_ai_enrichment_status_check
      check (ai_enrichment_status in ('pending', 'enriched', 'no_match', 'failed', 'skipped'));
  end if;
end $$;

-- Lets the AI batch pass find rows still needing a lookup cheaply.
create index if not exists companies_ai_enrichment_status_idx
  on public.companies (ai_enrichment_status)
  where ai_enrichment_status = 'pending';
