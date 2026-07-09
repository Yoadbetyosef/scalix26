-- Growth OS Sprint 6 — White Label / Reseller portal at scale.
-- Index for ordering/filtering the client table by recency, and a SQL aggregate so KPIs are O(1)
-- to read whether a partner has 5 clients or 50,000 (never sum in the browser). Idempotent.

CREATE INDEX IF NOT EXISTS idx_partner_clients_created ON partner_clients(partner_id, created_at DESC);

CREATE OR REPLACE FUNCTION partner_wholesale_summary(p_partner uuid)
RETURNS TABLE (
  active_clients bigint,
  total_clients bigint,
  monthly_retail_cents bigint,
  monthly_wholesale_cents bigint,
  new_this_month bigint,
  churned_clients bigint,
  priced_clients bigint
) LANGUAGE sql STABLE AS $$
  SELECT
    count(*) FILTER (WHERE status = 'active'),
    count(*),
    coalesce(sum(retail_price_cents) FILTER (WHERE status = 'active'), 0),
    coalesce(sum(wholesale_price_cents) FILTER (WHERE status = 'active'), 0),
    count(*) FILTER (WHERE created_at >= date_trunc('month', now())),
    count(*) FILTER (WHERE status = 'churned'),
    count(*) FILTER (WHERE status = 'active' AND (coalesce(retail_price_cents, 0) > 0 OR coalesce(wholesale_price_cents, 0) > 0))
  FROM partner_clients
  WHERE partner_id = p_partner;
$$;
