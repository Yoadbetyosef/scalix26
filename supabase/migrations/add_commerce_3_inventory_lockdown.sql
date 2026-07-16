-- ============================================================================
-- Commerce Phase 1c: lock inventory quantity mutation to the approved server path
-- ============================================================================
-- Data-integrity hardening. Inventory quantities (reserved / on_hand / incoming / damaged / allocated /
-- floor_display) and the movement ledger must ONLY change via approved service-role / SECURITY DEFINER
-- operations (lib/commerce recordMovement, and the Phase-2 reserve_inventory RPC) — never through an
-- ordinary authenticated tenant client, even though tenant-scoped RLS would otherwise allow the row.
--
-- Mechanism: remove direct write PRIVILEGES on the two inventory tables from anon + authenticated. This
-- is a table privilege (enforced by Postgres before RLS, non-spoofable — NOT a trigger flag or a
-- client-provided field). READ access is unchanged: SELECT stays granted, so the existing tenant RLS
-- SELECT policy (tenant_id = get_tenant_id()) continues to govern reads. service_role keeps ALL
-- privileges (it is how the approved server functions write). Idempotent.

REVOKE INSERT, UPDATE, DELETE ON commerce_inventory_levels    FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON commerce_inventory_movements FROM anon, authenticated;

-- These tables were created with a broad default grant (Supabase grants ALL on new public tables to
-- anon/authenticated). The REVOKE above removes the unsafe write paths from those roles for these
-- specific tables; SELECT remains so RLS-filtered reads still work. There is no other role with write
-- access besides service_role. (The catalog tables keep normal tenant write access — only the
-- quantity-bearing inventory tables are locked down.)
