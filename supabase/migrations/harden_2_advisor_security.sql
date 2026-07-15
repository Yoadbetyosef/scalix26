-- ============================================================================
-- Hardening 2 — Supabase Security Advisor fixes (views + referral partitions)
-- ============================================================================
-- Addresses the 5 Advisor findings. No USING(true) / WITH CHECK(true) anywhere.
-- All real callers use the service role (which bypasses RLS), so none of this
-- breaks referral tracking, partner commissions, WL billing, or admin reporting.
-- Idempotent.

-- ── 1) SECURITY DEFINER views -> run as the CALLER (RLS-enforced), and revoke the
--       default anon/authenticated grants (mirrors the apply_balance_txn hardening).
--       partner_ledger_reconciliation: only read manually / by service role.
--       unsettled_wl_usage: only read by the billing cron (service role).
ALTER VIEW public.partner_ledger_reconciliation SET (security_invoker = on);
ALTER VIEW public.unsettled_wl_usage           SET (security_invoker = on);

REVOKE ALL ON public.partner_ledger_reconciliation FROM anon, authenticated;
REVOKE ALL ON public.unsettled_wl_usage           FROM anon, authenticated;

-- ── 2) referral_clicks monthly partitions — enable RLS on EVERY existing child.
--       The parent has RLS enabled with NO partner policy by design (raw clicks are
--       PII; partners only ever see server-side aggregates). Postgres does not
--       inherit the RLS *enable flag* to partitions, so each child needs it set.
--       No policy is added -> service-role-only, matching the parent's intent.
DO $$
DECLARE child regclass;
BEGIN
  FOR child IN
    SELECT inhrelid::regclass
      FROM pg_inherits
     WHERE inhparent = 'public.referral_clicks'::regclass
  LOOP
    EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', child);
  END LOOP;
END $$;

-- ── 3) FUTURE partitions inherit RLS automatically: the monthly roll-forward
--       function now enables RLS on each partition it creates. (The nightly partner
--       cron calls this via the service role.)
CREATE OR REPLACE FUNCTION ensure_referral_clicks_partition()
RETURNS void AS $$
DECLARE
  m date := date_trunc('month', now() + interval '1 month')::date;
  pname text := 'referral_clicks_' || to_char(m, 'YYYY_MM');
BEGIN
  EXECUTE format(
    'CREATE TABLE IF NOT EXISTS %I PARTITION OF referral_clicks FOR VALUES FROM (%L) TO (%L)',
    pname, m, (m + interval '1 month')::date);
  -- New child partitions do NOT inherit the RLS enable flag from the parent — set it here.
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', pname);
END;
$$ LANGUAGE plpgsql;
