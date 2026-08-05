-- ============================================================================
-- Catalog ingestion — Phase 1: sources, ingested products, and the sync queue.
--
-- A tenant pastes their website URL; a worker detects the platform, reads their products, and keeps
-- this copy in step with the site. Run in the Supabase SQL Editor.
--
-- WHAT THIS IS NOT: a staging area for catalog_products. That table is physical inventory — stock
-- counts per location, QR tokens, movements — and it is read live by the agent's catalog tools.
-- catalog_ingested_products is an INDEPENDENT knowledge source: what the business sells according to
-- their own website. Nothing here ever writes to catalog_products, and there is deliberately no
-- matching or promotion machinery. Putting a web product into inventory is a per-product action the
-- tenant takes, never a bulk or automatic one.
--
-- Style note: text + CHECK rather than Postgres ENUMs, matching add_business_catalog.sql and the rest
-- of this schema. Adding a value later is then an ALTER of one constraint, not a type migration.
--
-- Additive, idempotent. Safe to run more than once.
-- ============================================================================

-- ── Where a tenant's products come from ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS catalog_sources (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  source_url            text NOT NULL,                  -- normalized origin, no trailing slash
  source_type           text NOT NULL DEFAULT 'manual'
    CHECK (source_type IN ('shopify_api','woocommerce_api','product_feed','jsonld_crawl','html_ai','csv_upload','manual')),
  detected_platform     text,                           -- free text from the detector ("Shopify", "WooCommerce 8.4")
  credentials_encrypted text,                           -- reserved for authenticated sources; unused in phase 1
  sync_frequency        text NOT NULL DEFAULT 'daily' CHECK (sync_frequency IN ('daily','weekly','manual')),
  -- Staggering: every tenant syncs at their own hour so load spreads across the day instead of
  -- spiking at midnight. hashtext() is cast to bigint before abs() because hashtext can return
  -- int4's most negative value, whose abs() overflows.
  sync_hour             int NOT NULL DEFAULT 0 CHECK (sync_hour BETWEEN 0 AND 23),
  status                text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','detecting','syncing','active','failed','paused')),
  last_synced_at        timestamptz,
  last_status           text,                           -- machine-readable reason: ok | spa_unsupported | robots_blocked | fetch_failed | …
  error_log             jsonb,                          -- rolling array, last 5 errors, newest first
  products_found        int NOT NULL DEFAULT 0,
  progress              jsonb,                          -- { current, total, phase } for the live UI
  extraction_pattern    jsonb,                          -- selectors/paths discovered once, then reused deterministically
  ownership_confirmed   boolean NOT NULL DEFAULT false, -- the tenant attests they own the site
  deleted_at            timestamptz,                    -- soft delete; products stay, deactivated
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

-- One live source per URL per tenant — re-connecting the same site updates rather than duplicates.
CREATE UNIQUE INDEX IF NOT EXISTS catalog_sources_tenant_url_idx
  ON catalog_sources (tenant_id, source_url) WHERE deleted_at IS NULL;
-- The cron's only query: everything due this hour.
CREATE INDEX IF NOT EXISTS catalog_sources_status_hour_idx
  ON catalog_sources (status, sync_hour) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS catalog_sources_tenant_idx ON catalog_sources (tenant_id);

-- ── The products themselves ─────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS catalog_ingested_products (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  source_id      uuid REFERENCES catalog_sources(id) ON DELETE CASCADE,   -- null for a hand-added product
  source_type    text NOT NULL DEFAULT 'manual'
    CHECK (source_type IN ('shopify_api','woocommerce_api','product_feed','jsonld_crawl','html_ai','csv_upload','manual')),
  external_id    text,                                  -- the platform's product id, else sha256(product_url)
  title          text NOT NULL,
  description    text,
  price          numeric(12,2),
  compare_price  numeric(12,2),
  currency       text NOT NULL DEFAULT 'USD',
  sku            text,
  image_url      text,                                  -- hotlinked; nothing is copied into storage
  product_url    text,
  availability   text CHECK (availability IS NULL OR availability IN ('in_stock','out_of_stock','unknown')),
  raw_payload    jsonb,                                 -- the full source object, variants included
  content_hash   text NOT NULL,                         -- sha256 of the normalized fields — drives diffing
  is_locked      boolean NOT NULL DEFAULT false,        -- tenant edited it by hand → a sync must never overwrite
  is_active      boolean NOT NULL DEFAULT true,         -- gone from the site → false. Nothing is ever deleted.
  first_seen_at  timestamptz NOT NULL DEFAULT now(),
  last_seen_at   timestamptz NOT NULL DEFAULT now(),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

-- The diff key. source_id is NULL for hand-added products, and NULLs are distinct in a unique
-- constraint, so manual rows never collide with each other or with a sync.
CREATE UNIQUE INDEX IF NOT EXISTS catalog_ingested_products_key_idx
  ON catalog_ingested_products (tenant_id, source_id, external_id);

CREATE INDEX IF NOT EXISTS catalog_ingested_products_tenant_active_idx
  ON catalog_ingested_products (tenant_id, is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS catalog_ingested_products_tenant_seen_idx
  ON catalog_ingested_products (tenant_id, last_seen_at);
CREATE INDEX IF NOT EXISTS catalog_ingested_products_source_external_idx
  ON catalog_ingested_products (source_id, external_id);

-- ── The sync queue ──────────────────────────────────────────────────────────────────────────────────
-- Vercel's cron enqueues; the Railway worker claims. Attempts and run_after live here rather than on
-- the source, so a retry schedule is a property of the run and never mutates the tenant's settings.

CREATE TABLE IF NOT EXISTS catalog_sync_jobs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  source_id    uuid NOT NULL REFERENCES catalog_sources(id) ON DELETE CASCADE,
  trigger      text NOT NULL DEFAULT 'cron' CHECK (trigger IN ('initial','cron','manual')),
  status       text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','succeeded','failed')),
  attempts     int  NOT NULL DEFAULT 0,
  max_attempts int  NOT NULL DEFAULT 3,
  run_after    timestamptz NOT NULL DEFAULT now(),      -- exponential backoff between attempts
  claimed_by   text,                                    -- worker instance id, for debugging a stuck run
  claimed_at   timestamptz,
  started_at   timestamptz,
  finished_at  timestamptz,
  error        text,                                    -- human-readable reason on the final failure
  -- Run metrics: products seen/inserted/updated/deactivated, pages fetched, ua_fallbacks (how often
  -- the honest bot UA got refused), llm_calls and llm_cost_usd for the Haiku tier.
  stats        jsonb,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- At most one live job per source — the hourly cron cannot pile jobs onto a source that is still
-- running, and a manual re-sync during a run is a no-op rather than a duplicate crawl.
CREATE UNIQUE INDEX IF NOT EXISTS catalog_sync_jobs_one_live_idx
  ON catalog_sync_jobs (source_id) WHERE status IN ('queued','running');
CREATE INDEX IF NOT EXISTS catalog_sync_jobs_claimable_idx
  ON catalog_sync_jobs (status, run_after) WHERE status = 'queued';
CREATE INDEX IF NOT EXISTS catalog_sync_jobs_source_idx ON catalog_sync_jobs (source_id, created_at DESC);

-- ── RLS ─────────────────────────────────────────────────────────────────────────────────────────────
-- Enabled with NO policy, matching catalog_products and usage_events: every read and write goes
-- through the server (admin client, after auth + active-workspace tenant resolution in
-- requireCatalogTenant), and the worker connects with the service role. This is deliberately not the
-- older `tenant_id = get_tenant_id()` pattern — that helper resolves a tenant from auth.uid() and so
-- returns the wrong tenant (or none) whenever a White Label operator is working inside a client
-- workspace, which is exactly when the catalog must still be reachable.

ALTER TABLE catalog_sources            ENABLE ROW LEVEL SECURITY;
ALTER TABLE catalog_ingested_products  ENABLE ROW LEVEL SECURITY;
ALTER TABLE catalog_sync_jobs          ENABLE ROW LEVEL SECURITY;

-- ── Atomic job claim ────────────────────────────────────────────────────────────────────────────────
-- FOR UPDATE SKIP LOCKED cannot be expressed through PostgREST, so it lives here and the worker calls
-- it with .rpc() — the same shape as apply_balance_txn and cc_move_hire_to_reality. Two worker
-- instances can run the loop concurrently and will never claim the same job.

CREATE OR REPLACE FUNCTION claim_catalog_sync_jobs(p_worker text, p_limit int DEFAULT 1)
RETURNS SETOF catalog_sync_jobs
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH claimed AS (
    SELECT id FROM catalog_sync_jobs
    WHERE status = 'queued' AND run_after <= now()
    ORDER BY run_after
    LIMIT GREATEST(p_limit, 0)
    FOR UPDATE SKIP LOCKED
  )
  UPDATE catalog_sync_jobs j
     SET status     = 'running',
         attempts   = j.attempts + 1,
         claimed_by = p_worker,
         claimed_at = now(),
         started_at = COALESCE(j.started_at, now())
    FROM claimed c
   WHERE j.id = c.id
  RETURNING j.*;
$$;

-- Only the service role runs the loop; nothing client-side may claim work.
REVOKE ALL ON FUNCTION claim_catalog_sync_jobs(text, int) FROM PUBLIC, anon, authenticated;

-- ── Sync-hour assignment ────────────────────────────────────────────────────────────────────────────
-- Stable per tenant, so all of a tenant's sources sync together and the spread stays even as tenants
-- are added. Cast to bigint before abs(): hashtext() can return -2147483648, and abs() of that
-- overflows int4.

CREATE OR REPLACE FUNCTION catalog_sync_hour(p_tenant uuid)
RETURNS int
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT (abs(hashtext(p_tenant::text)::bigint) % 24)::int;
$$;

-- ── Rollback ────────────────────────────────────────────────────────────────────────────────────────
-- DROP FUNCTION IF EXISTS claim_catalog_sync_jobs(text, int);
-- DROP FUNCTION IF EXISTS catalog_sync_hour(uuid);
-- DROP TABLE IF EXISTS catalog_sync_jobs;
-- DROP TABLE IF EXISTS catalog_ingested_products;
-- DROP TABLE IF EXISTS catalog_sources;
-- Nothing outside these three tables is touched, so the rollback is complete: catalog_products,
-- catalog_movements and usage_events are unaffected by this migration.
