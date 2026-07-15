-- ============================================================================
-- Hardening 1 — Business Knowledge becomes TENANT-owned (not AI-Employee-owned)
-- ============================================================================
-- Root cause of the "Tatiana lost her Business Knowledge" incident:
--   knowledge_base.ai_employee_id -> ai_employees(id) ON DELETE CASCADE.
--   Deleting/replacing an agent hard-deleted every knowledge row with it.
--
-- New ownership model:
--   * tenant_id is the authoritative owner (NOT NULL).
--   * ai_employee_id IS NULL      -> TENANT-WIDE shared knowledge (every agent sees it).
--   * ai_employee_id IS <agent>   -> OPTIONAL agent-specific knowledge (that agent, in
--                                     ADDITION to the shared tenant knowledge).
--   * Deleting an agent NEVER deletes knowledge: ON DELETE SET NULL converts any
--     agent-specific rows to tenant-wide shared (they survive, just become shared).
--
-- Data handling for the existing rows (justified, NOT a blind blanket NULL):
--   Inspected 2026-07-14: 39 rows across 6 tenants; EVERY knowledge-owning tenant has
--   exactly ONE AI Employee, and no tenant has knowledge split across agents. No
--   agent-specific-knowledge feature existed, so no row was ever intentionally
--   agent-specific — the binding was an artifact of the writers always using the
--   current agent. The primary AI consumption paths (inference pipeline, email reply,
--   Amy) ALREADY read knowledge tenant-wide, so these rows are already effectively
--   shared. Converting them to tenant-wide therefore PRESERVES behavior and lets
--   replacement/future agents inherit the knowledge. The prior binding is retained in
--   origin_ai_employee_id as provenance, so no association is lost.
--
-- Idempotent. Safe to run more than once. Does NOT touch Tatiana's tenant (0 rows).

-- 1) Replace the CASCADE foreign key with ON DELETE SET NULL (find it by definition,
--    so we don't depend on the auto-generated constraint name).
DO $$
DECLARE cname text;
BEGIN
  SELECT conname INTO cname
    FROM pg_constraint
   WHERE conrelid = 'public.knowledge_base'::regclass
     AND contype = 'f'
     AND pg_get_constraintdef(oid) ILIKE '%ai_employee_id%references%ai_employees%';
  IF cname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.knowledge_base DROP CONSTRAINT %I', cname);
  END IF;
END $$;

ALTER TABLE public.knowledge_base
  ADD CONSTRAINT knowledge_base_ai_employee_id_fkey
  FOREIGN KEY (ai_employee_id) REFERENCES public.ai_employees(id) ON DELETE SET NULL;

-- 2) Tenant is the authoritative ownership boundary.
ALTER TABLE public.knowledge_base ALTER COLUMN tenant_id SET NOT NULL;

-- 3) Provenance: which agent originally created the row. Plain uuid (no FK) so it
--    survives agent deletion and never causes a cascade.
ALTER TABLE public.knowledge_base ADD COLUMN IF NOT EXISTS origin_ai_employee_id uuid;
COMMENT ON COLUMN public.knowledge_base.origin_ai_employee_id IS
  'Provenance only: the AI Employee that originally created this row. Not an ownership/visibility key.';

-- 4) Convert existing agent-bound rows to tenant-wide shared, preserving provenance.
UPDATE public.knowledge_base
   SET origin_ai_employee_id = COALESCE(origin_ai_employee_id, ai_employee_id),
       ai_employee_id = NULL
 WHERE ai_employee_id IS NOT NULL;

-- 5) Indexes for the "tenant-wide UNION active-agent" read pattern.
CREATE INDEX IF NOT EXISTS idx_kb_tenant ON public.knowledge_base (tenant_id);
CREATE INDEX IF NOT EXISTS idx_kb_tenant_agent ON public.knowledge_base (tenant_id, ai_employee_id);

-- RLS is unchanged: the existing tenant policy (tenant_id = get_tenant_id()) still
-- enforces cross-tenant isolation. No USING(true) anywhere.
