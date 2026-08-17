-- ============================================================================
-- Catalog retrieval — Phase 2: tell an over-strict miss apart from an honest one.
--
-- ── THE CALL THAT PROMPTED THIS ─────────────────────────────────────────────────────────────────────
--
-- A caller asked Your Design Collective for a "RAJA sofa". The tenant holds eight RAJA products,
-- including `RAJA 2,5 PL` — a 2.5-seater, which is the sofa they wanted. The agent said:
--
--     "I'm not seeing it in the system at the moment."
--
-- Every column in this table recorded that as an ordinary miss: resolved=false, timed_out=false,
-- errored=false. Indistinguishable from a business that genuinely does not sell the thing.
--
-- It was not a miss. Tokens are ANDed, so "raja sofa" required one product matching BOTH words; no RAJA
-- product contains "sofa" and no sofa contains "raja". Searching "raja" alone matches eight. The ladder
-- could have dropped a token and did not — see the floor arithmetic in lib/catalog/retrieval.ts.
--
-- ── WHY THAT MATTERS BEYOND THE BUG ─────────────────────────────────────────────────────────────────
--
-- The miss list from this table is the evidence deciding whether embeddings are worth adding. An
-- over-strict AND is a LEXICAL failure with a one-line fix; it looks exactly like the SEMANTIC failure
-- embeddings exist to solve. Left unlabelled, this table would have quietly argued for a vector index,
-- an embedding lifecycle and a second failure mode on the call path — to fix arithmetic.
--
-- So a resolution now records HOW it was reached, and a miss records how hard we looked.
--
-- Additive, idempotent. Safe to run more than once.
-- ============================================================================

-- How many tokens the normalized query had, and how many the rung that actually answered used.
-- Equal → the full phrase matched. Fewer → a reduced phrase did, which is a PARTIAL answer and must
-- read differently in the miss table and out loud. Zero matched → nothing was found at any rung.
ALTER TABLE catalog_retrieval_log ADD COLUMN IF NOT EXISTS query_tokens   int;
ALTER TABLE catalog_retrieval_log ADD COLUMN IF NOT EXISTS matched_tokens int;

-- Denormalised from the two above so the common read is an index scan rather than arithmetic in a
-- WHERE clause. `partial` means: we answered, but about something narrower than the caller asked for.
ALTER TABLE catalog_retrieval_log ADD COLUMN IF NOT EXISTS partial boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN catalog_retrieval_log.partial IS
  'Resolved from a REDUCED token set — the full phrase matched nothing and a subset did. The caller was told what we do have, framed as a question, not given a confident answer to the question they asked. Counting these as clean resolutions overstates recall; counting them as misses understates it.';
COMMENT ON COLUMN catalog_retrieval_log.matched_tokens IS
  'Tokens used by the rung that answered; 0 on a miss. With query_tokens this is what separates a lexical failure (a subset would have matched) from a semantic one (nothing matched at any width) — the distinction the embeddings decision rests on.';

CREATE INDEX IF NOT EXISTS catalog_retrieval_log_partial_idx
  ON catalog_retrieval_log (tenant_id, created_at DESC) WHERE partial;

-- ── Reading it ──────────────────────────────────────────────────────────────────────────────────────
--
-- The miss list that decides on embeddings must now exclude partials, because a partial is a lexical
-- narrowing we already fixed rather than a product we could not find:
--
--   SELECT query, count(*) AS times, max(created_at) AS last_seen
--   FROM catalog_retrieval_log
--   WHERE NOT resolved AND NOT errored AND NOT timed_out AND surface <> 'test'
--     AND created_at > now() - interval '30 days'
--   GROUP BY query ORDER BY times DESC LIMIT 50;
--
-- And the health of the ladder itself — how often the full phrase fails and a subset rescues it:
--
--   SELECT surface,
--          count(*) FILTER (WHERE resolved AND NOT partial) AS full_answers,
--          count(*) FILTER (WHERE partial)                  AS partial_answers,
--          count(*) FILTER (WHERE NOT resolved AND NOT timed_out AND NOT errored) AS real_misses,
--          count(*) FILTER (WHERE timed_out)                AS timeouts,
--          round(avg(query_tokens), 1)                      AS avg_tokens
--   FROM catalog_retrieval_log
--   WHERE created_at > now() - interval '7 days' AND surface <> 'test'
--   GROUP BY surface;
--
-- A partial rate that climbs is not a retrieval problem — it is product NAMES not matching how callers
-- say them, which is a naming problem and is fixed in the catalogue, not here.

-- ── Reverse (down) ──────────────────────────────────────────────────────────────────────────────────
-- DROP INDEX IF EXISTS catalog_retrieval_log_partial_idx;
-- ALTER TABLE catalog_retrieval_log
--   DROP COLUMN IF EXISTS partial, DROP COLUMN IF EXISTS matched_tokens, DROP COLUMN IF EXISTS query_tokens;
