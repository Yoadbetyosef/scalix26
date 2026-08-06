-- ============================================================================
-- Catalog retrieval — Phase 1: the miss-rate log, and indexes for lexical search.
--
-- Semantic search was deliberately deferred: on catalogues whose titles spell out every attribute
-- ("Emerald Cut Diamond Hidden Halo Engagement Ring in Platinum"), tokenised lexical matching already
-- finds the row and embeddings buy little. That decision is only honest if it can be revisited with
-- evidence, which is what this table is for: every retrieval, what was asked, and whether it resolved.
--
-- Run in the Supabase SQL Editor. Additive, idempotent.
-- ============================================================================

-- ── What was asked, and did we answer it ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS catalog_retrieval_log (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  -- What the caller actually said, and the normalized form we searched on. Both, because the gap
  -- between them is where a miss usually lives.
  query         text NOT NULL,
  normalized    text NOT NULL,
  -- voice | text | test — 'test' is the tenant trying phrases in the catalog screen, and it must be
  -- separable from real calls when reading the miss rate.
  surface       text NOT NULL DEFAULT 'text' CHECK (surface IN ('voice','text','test')),
  matched       int  NOT NULL DEFAULT 0,      -- rows found before grouping
  groups        int  NOT NULL DEFAULT 0,      -- answer objects after grouping
  resolved      boolean NOT NULL DEFAULT false,  -- did the caller get a usable answer
  clarifying    boolean NOT NULL DEFAULT false,  -- resolved, but as a range + a question
  latency_ms    int,
  timed_out     boolean NOT NULL DEFAULT false,
  -- Both lookups failed. Kept apart from a miss on purpose: an outage must not be read later as
  -- evidence that the catalogue lacked the product, because that is the number deciding whether
  -- embeddings are worth adding.
  errored       boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- The two reads this table exists for: "what is my miss rate" and "which phrases missed".
CREATE INDEX IF NOT EXISTS catalog_retrieval_log_tenant_idx ON catalog_retrieval_log (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS catalog_retrieval_log_misses_idx ON catalog_retrieval_log (tenant_id, created_at DESC) WHERE NOT resolved;

-- Server-only, like every other table in this module.
ALTER TABLE catalog_retrieval_log ENABLE ROW LEVEL SECURITY;

-- ── Lexical search indexes ──────────────────────────────────────────────────────────────────────────
-- A caller says "emerald cut halo ring"; no row contains that as a substring, so retrieval matches
-- word by word with leading wildcards — which no btree can serve. Trigram GIN indexes are what keep
-- that fast as a catalogue grows past the ~9k where a sequential scan still measures fine.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS catalog_ingested_products_title_trgm_idx
  ON catalog_ingested_products USING gin (title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS catalog_ingested_products_sku_trgm_idx
  ON catalog_ingested_products USING gin (sku gin_trgm_ops) WHERE sku IS NOT NULL;

CREATE INDEX IF NOT EXISTS catalog_products_name_trgm_idx
  ON catalog_products USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS catalog_products_sku_trgm_idx
  ON catalog_products USING gin (sku gin_trgm_ops) WHERE sku IS NOT NULL;

-- ── Reading the miss rate ───────────────────────────────────────────────────────────────────────────
-- Overall, last 7 days, real calls only:
--
--   SELECT surface,
--          count(*)                                   AS queries,
--          count(*) FILTER (WHERE resolved)           AS resolved,
--          count(*) FILTER (WHERE errored)            AS errored,
--          round(100.0 * count(*) FILTER (WHERE NOT resolved) / count(*), 1) AS miss_pct,
--          round(avg(latency_ms))                     AS avg_ms,
--          max(latency_ms)                            AS max_ms
--   FROM catalog_retrieval_log
--   WHERE created_at > now() - interval '7 days'
--   GROUP BY surface;
--
-- The phrases that missed — this is the list that decides whether embeddings are worth adding:
--
--   SELECT query, count(*) AS times, max(created_at) AS last_seen
--   FROM catalog_retrieval_log
--   WHERE NOT resolved AND NOT errored AND surface <> 'test' AND created_at > now() - interval '30 days'
--   GROUP BY query ORDER BY times DESC LIMIT 50;

-- ── Rollback ────────────────────────────────────────────────────────────────────────────────────────
-- DROP TABLE IF EXISTS catalog_retrieval_log;
-- DROP INDEX IF EXISTS catalog_ingested_products_title_trgm_idx, catalog_ingested_products_sku_trgm_idx,
--                      catalog_products_name_trgm_idx, catalog_products_sku_trgm_idx;
-- (pg_trgm is left installed; other things may come to depend on it.)
