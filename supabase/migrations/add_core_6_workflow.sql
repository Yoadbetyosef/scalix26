-- ============================================================================
-- Scalix Core — Phase 6: Workflow Foundation
-- ============================================================================
-- Additive & non-destructive. Generic workflow engine that later powers furniture/jewelry production,
-- memo/consignment, gym/dental/home-service jobs — as CONFIGURED stage sets, not hard-coded code.
--   workflow_definitions → workflow_stages → workflow_transitions (allowed edges)
--   workflow_instances (a record's current stage) → workflow_stage_history
-- Transitions go through ONE atomic RPC that validates the edge is allowed. Real RLS. Idempotent.
-- Run in the Supabase SQL Editor.

CREATE TABLE IF NOT EXISTS workflow_definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  key text NOT NULL, name text NOT NULL, record_type text NOT NULL,   -- which entity: order|estimate|component|job|…
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, key));

CREATE TABLE IF NOT EXISTS workflow_stages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  workflow_definition_id uuid NOT NULL REFERENCES workflow_definitions(id) ON DELETE CASCADE,
  key text NOT NULL, label text NOT NULL, sort_order integer NOT NULL DEFAULT 0,
  is_initial boolean NOT NULL DEFAULT false, is_terminal boolean NOT NULL DEFAULT false,
  is_success boolean NOT NULL DEFAULT false, is_failed boolean NOT NULL DEFAULT false,
  UNIQUE (workflow_definition_id, key));
CREATE INDEX IF NOT EXISTS idx_wf_stages_def ON workflow_stages (tenant_id, workflow_definition_id, sort_order);

CREATE TABLE IF NOT EXISTS workflow_transitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  workflow_definition_id uuid NOT NULL REFERENCES workflow_definitions(id) ON DELETE CASCADE,
  from_stage_id uuid REFERENCES workflow_stages(id) ON DELETE CASCADE,   -- null = allowed from the initial entry
  to_stage_id uuid NOT NULL REFERENCES workflow_stages(id) ON DELETE CASCADE,
  UNIQUE (workflow_definition_id, from_stage_id, to_stage_id));

CREATE TABLE IF NOT EXISTS workflow_instances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  workflow_definition_id uuid NOT NULL REFERENCES workflow_definitions(id) ON DELETE CASCADE,
  record_type text NOT NULL, record_id uuid NOT NULL,
  current_stage_id uuid REFERENCES workflow_stages(id) ON DELETE SET NULL,
  assigned_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL, due_at timestamptz,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','completed','failed','cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, workflow_definition_id, record_type, record_id));

CREATE TABLE IF NOT EXISTS workflow_stage_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  instance_id uuid NOT NULL REFERENCES workflow_instances(id) ON DELETE CASCADE,
  from_stage_id uuid, to_stage_id uuid NOT NULL, actor uuid, note text, created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS idx_wf_hist_instance ON workflow_stage_history (tenant_id, instance_id, created_at DESC);

DO $$ DECLARE t text; BEGIN
  FOR t IN SELECT unnest(ARRAY['workflow_definitions','workflow_stages','workflow_transitions','workflow_instances','workflow_stage_history']) LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t||'_tenant', t);
    EXECUTE format('CREATE POLICY %I ON %I FOR ALL USING (tenant_id = get_tenant_id()) WITH CHECK (tenant_id = get_tenant_id())', t||'_tenant', t);
  END LOOP; END $$;

-- Atomic, validated transition: moves an instance to to_stage only if the edge (current → to) is allowed,
-- records history, and sets instance status from the target stage's success/failed/terminal flags.
CREATE OR REPLACE FUNCTION core_workflow_transition(p_tenant uuid, p_instance uuid, p_to_stage uuid, p_actor uuid, p_note text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_def uuid; v_cur uuid; v_allowed boolean; v_term boolean; v_succ boolean; v_fail boolean;
BEGIN
  SELECT workflow_definition_id, current_stage_id INTO v_def, v_cur FROM workflow_instances WHERE id = p_instance AND tenant_id = p_tenant FOR UPDATE;
  IF v_def IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'instance_not_found'); END IF;
  IF NOT EXISTS (SELECT 1 FROM workflow_stages WHERE id = p_to_stage AND tenant_id = p_tenant AND workflow_definition_id = v_def) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'stage_not_in_workflow');
  END IF;
  SELECT EXISTS (SELECT 1 FROM workflow_transitions WHERE tenant_id = p_tenant AND workflow_definition_id = v_def
                 AND to_stage_id = p_to_stage AND (from_stage_id = v_cur OR (from_stage_id IS NULL AND v_cur IS NULL)))
    INTO v_allowed;
  IF NOT v_allowed THEN RETURN jsonb_build_object('ok', false, 'error', 'transition_not_allowed'); END IF;
  SELECT is_terminal, is_success, is_failed INTO v_term, v_succ, v_fail FROM workflow_stages WHERE id = p_to_stage;

  UPDATE workflow_instances SET current_stage_id = p_to_stage, updated_at = now(),
    status = CASE WHEN v_fail THEN 'failed' WHEN v_succ THEN 'completed' WHEN v_term THEN 'completed' ELSE 'active' END
    WHERE id = p_instance AND tenant_id = p_tenant;
  INSERT INTO workflow_stage_history (tenant_id, instance_id, from_stage_id, to_stage_id, actor, note)
    VALUES (p_tenant, p_instance, v_cur, p_to_stage, p_actor, p_note);
  RETURN jsonb_build_object('ok', true, 'from', v_cur, 'to', p_to_stage, 'terminal', COALESCE(v_term, false));
END $$;
REVOKE ALL ON FUNCTION core_workflow_transition(uuid,uuid,uuid,uuid,text) FROM PUBLIC, anon, authenticated;
