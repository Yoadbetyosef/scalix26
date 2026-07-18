-- ============================================================================
-- Scalix Core — Phase 2: Shared Customer & Relationship Layer
-- ============================================================================
-- Additive & non-destructive. Adds companies, contact↔company links, a unified
-- activities timeline, polymorphic files, cross-channel identities, contact
-- extensions (archive/owner/dedupe keys/merge pointer), and an ATOMIC contact
-- merge RPC. New tables get real RLS (get_tenant_id()); the app also scopes by
-- tenant via the admin-client repositories (works in owner + WL-operator modes).
-- Run in the Supabase SQL Editor. Idempotent.

-- ── companies (customer-side, NOT tenants) ──────────────────────────────────
CREATE TABLE IF NOT EXISTS companies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  domain text, email text, phone text, address text, notes text,
  archived_at timestamptz,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS idx_companies_tenant ON companies (tenant_id, archived_at);

-- ── contact extensions (additive) ───────────────────────────────────────────
ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS archived_at timestamptz,
  ADD COLUMN IF NOT EXISTS owner_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES companies(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS normalized_phone text,
  ADD COLUMN IF NOT EXISTS normalized_email text,
  ADD COLUMN IF NOT EXISTS merged_into_id uuid REFERENCES contacts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS tags text[] NOT NULL DEFAULT '{}';
CREATE INDEX IF NOT EXISTS idx_contacts_norm_phone ON contacts (tenant_id, normalized_phone);
CREATE INDEX IF NOT EXISTS idx_contacts_norm_email ON contacts (tenant_id, normalized_email);
CREATE INDEX IF NOT EXISTS idx_contacts_archived  ON contacts (tenant_id, archived_at);
CREATE INDEX IF NOT EXISTS idx_contacts_merged     ON contacts (tenant_id, merged_into_id);

-- ── contact ↔ company (M:N) ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS contact_companies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  contact_id uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  role text, is_primary boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, contact_id, company_id));
CREATE INDEX IF NOT EXISTS idx_contact_companies_company ON contact_companies (tenant_id, company_id);

-- ── activities (unified customer/record timeline) ───────────────────────────
CREATE TABLE IF NOT EXISTS activities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  contact_id uuid REFERENCES contacts(id) ON DELETE SET NULL,
  company_id uuid REFERENCES companies(id) ON DELETE SET NULL,
  subject_type text,                 -- open vocabulary: conversation|appointment|order|estimate|invoice|payment|contact|…
  subject_id uuid,
  type text NOT NULL,                -- note|call|email|sms|appointment|status_change|merge|archive|system|…
  title text, body text,
  actor_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS idx_activities_contact ON activities (tenant_id, contact_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_activities_subject ON activities (tenant_id, subject_type, subject_id);

-- ── files (polymorphic attachments; generalizes lib/orders/attachments.ts) ──
CREATE TABLE IF NOT EXISTS files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  owner_type text NOT NULL,          -- contact|company|product|variant|estimate|quote|order|invoice|…
  owner_id uuid NOT NULL,
  bucket text NOT NULL DEFAULT 'core-files',
  path text NOT NULL, filename text, content_type text, size_bytes bigint,
  visibility text NOT NULL DEFAULT 'private' CHECK (visibility IN ('private','public')),
  uploaded_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS idx_files_owner ON files (tenant_id, owner_type, owner_id, created_at DESC);

-- ── channel identities (cross-channel contact unification) ───────────────────
CREATE TABLE IF NOT EXISTS channel_identities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  contact_id uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  channel text NOT NULL,             -- sms|email|whatsapp|instagram|facebook|voice|webchat
  external_id text NOT NULL,         -- normalized phone / lowercased email / social id
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, channel, external_id));
CREATE INDEX IF NOT EXISTS idx_channel_identities_contact ON channel_identities (tenant_id, contact_id);

-- ── RLS: real tenant policies on every new table ────────────────────────────
DO $$ DECLARE t text; BEGIN
  FOR t IN SELECT unnest(ARRAY['companies','contact_companies','activities','files','channel_identities']) LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t||'_tenant', t);
    EXECUTE format('CREATE POLICY %I ON %I FOR ALL USING (tenant_id = get_tenant_id()) WITH CHECK (tenant_id = get_tenant_id())', t||'_tenant', t);
  END LOOP; END $$;

-- ── atomic contact merge: repoint all linked records, preserve history ───────
-- Merges p_loser INTO p_winner in ONE transaction. Idempotent (re-merging a merged
-- loser is a no-op). Deletes only the loser's rows that would violate a uniqueness
-- constraint on the winner; repoints everything else. Records a 'merge' activity.
CREATE OR REPLACE FUNCTION core_merge_contacts(p_tenant uuid, p_winner uuid, p_loser uuid, p_actor uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_conv int; v_appt int; v_lead int; v_act int; v_ident int; v_link int;
BEGIN
  IF p_winner = p_loser THEN RETURN jsonb_build_object('ok', false, 'error', 'same_contact'); END IF;
  IF NOT EXISTS (SELECT 1 FROM contacts WHERE id = p_winner AND tenant_id = p_tenant) THEN RETURN jsonb_build_object('ok', false, 'error', 'winner_not_found'); END IF;
  IF NOT EXISTS (SELECT 1 FROM contacts WHERE id = p_loser  AND tenant_id = p_tenant) THEN RETURN jsonb_build_object('ok', false, 'error', 'loser_not_found'); END IF;
  IF EXISTS (SELECT 1 FROM contacts WHERE id = p_loser AND merged_into_id IS NOT NULL) THEN RETURN jsonb_build_object('ok', true, 'idempotent', true); END IF;

  UPDATE conversations SET contact_id = p_winner WHERE contact_id = p_loser AND tenant_id = p_tenant; GET DIAGNOSTICS v_conv = ROW_COUNT;
  UPDATE appointments  SET contact_id = p_winner WHERE contact_id = p_loser AND tenant_id = p_tenant; GET DIAGNOSTICS v_appt = ROW_COUNT;
  UPDATE leads         SET contact_id = p_winner WHERE contact_id = p_loser AND tenant_id = p_tenant; GET DIAGNOSTICS v_lead = ROW_COUNT;
  UPDATE activities    SET contact_id = p_winner WHERE contact_id = p_loser AND tenant_id = p_tenant; GET DIAGNOSTICS v_act  = ROW_COUNT;

  -- unique (tenant,channel,external_id): drop loser rows the winner already has, then repoint the rest.
  DELETE FROM channel_identities l WHERE l.contact_id = p_loser AND l.tenant_id = p_tenant
    AND EXISTS (SELECT 1 FROM channel_identities w WHERE w.tenant_id = p_tenant AND w.contact_id = p_winner AND w.channel = l.channel AND w.external_id = l.external_id);
  UPDATE channel_identities SET contact_id = p_winner WHERE contact_id = p_loser AND tenant_id = p_tenant; GET DIAGNOSTICS v_ident = ROW_COUNT;

  -- unique (tenant,contact,company): drop loser links the winner already has, then repoint the rest.
  DELETE FROM contact_companies l WHERE l.contact_id = p_loser AND l.tenant_id = p_tenant
    AND EXISTS (SELECT 1 FROM contact_companies w WHERE w.tenant_id = p_tenant AND w.contact_id = p_winner AND w.company_id = l.company_id);
  UPDATE contact_companies SET contact_id = p_winner WHERE contact_id = p_loser AND tenant_id = p_tenant; GET DIAGNOSTICS v_link = ROW_COUNT;

  UPDATE files SET owner_id = p_winner WHERE owner_type = 'contact' AND owner_id = p_loser AND tenant_id = p_tenant;
  -- money-side records carry a typeless contact_id (isolation debt, Phase-2 documented); repoint by value.
  UPDATE orders           SET contact_id = p_winner WHERE contact_id = p_loser AND tenant_id = p_tenant;

  UPDATE contacts SET merged_into_id = p_winner, archived_at = now(), updated_at = now() WHERE id = p_loser AND tenant_id = p_tenant;

  INSERT INTO activities (tenant_id, contact_id, type, title, body, actor_user_id, metadata)
    VALUES (p_tenant, p_winner, 'merge', 'Contact merged',
            format('Merged contact %s into this one', p_loser), p_actor,
            jsonb_build_object('loser', p_loser, 'moved', jsonb_build_object('conversations', v_conv, 'appointments', v_appt, 'leads', v_lead, 'activities', v_act, 'identities', v_ident, 'company_links', v_link)));

  RETURN jsonb_build_object('ok', true, 'winner', p_winner, 'loser', p_loser,
    'moved', jsonb_build_object('conversations', v_conv, 'appointments', v_appt, 'leads', v_lead, 'activities', v_act, 'identities', v_ident, 'company_links', v_link));
END $$;
REVOKE ALL ON FUNCTION core_merge_contacts(uuid,uuid,uuid,uuid) FROM PUBLIC, anon, authenticated;
