-- ============================================================
-- 038 — knowledge sources keep their insights, not just a summary
--
-- A source used to be reduced to one 3–6 sentence summary, and the hook
-- generator read at most 2,000 characters across all sources. A 3-hour
-- webinar became one paragraph.
--
-- Now the full text is mined, chunk by chunk, for self-contained hook seeds
-- (story / quote / number / pain / opinion / tip). They live here as a JSON
-- array of {kind, text}; generators sample from it, so successive batches
-- draw on different parts of the same material.
--
-- Existing rows keep their summary and get an empty array — the generator
-- falls back to the summary for them.
-- ============================================================

alter table business_sources
  add column insights jsonb not null default '[]'::jsonb;
