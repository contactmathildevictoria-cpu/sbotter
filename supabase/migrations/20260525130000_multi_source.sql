-- Register the five additional job sources alongside Jobnet. Each gets its own
-- custom Apify Actor (apify-actors/<source>/) that POSTs to /api/ingest/apify
-- with ?source=<id>. A data_sources row MUST exist before any job_postings row
-- for that source can be inserted (job_postings.source_id is an FK with
-- on delete restrict). No column additions are needed — source_id already
-- supports N sources, and per-job provenance lives there.

insert into public.data_sources (id, name, base_url, country, active) values
  ('jobindex',  'Jobindex.dk',   'https://www.jobindex.dk',   'DK', true),
  ('jobdanmark','JobDanmark.dk', 'https://www.jobdanmark.dk', 'DK', true),
  ('indeed',    'Indeed (DK)',   'https://dk.indeed.com',     'DK', true),
  ('moment',    'Moment',        'https://www.moment.dk',     'DK', true),
  ('randstad',  'Randstad (DK)', 'https://www.randstad.dk',   'DK', true)
on conflict (id) do nothing;
