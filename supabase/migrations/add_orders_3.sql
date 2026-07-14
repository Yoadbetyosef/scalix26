-- ============================================================================
-- Orders module — Phase 3: external approval requests + their permitted attachments.
-- The public /approval/[token] page reaches a single request via a SHA-256 token hash (raw token only ever
-- lives in the email link, never stored/logged). Statuses are versioned; old tokens are revoked on resend.
-- RLS tenant-scoped for Tatiana's admin views; the public route uses the service role + token-hash validation.
-- Run AFTER add_orders_2.sql.
-- ============================================================================
CREATE TABLE IF NOT EXISTS order_approval_requests (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                 uuid NOT NULL,
  order_id                  uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  approval_type             text NOT NULL CHECK (approval_type IN ('factory','customer')),
  recipient_name            text,
  recipient_email           text NOT NULL,
  token_hash                text NOT NULL,                     -- SHA-256(token); raw token never stored
  status                    text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','sent','opened','approved','changes_requested','rejected','expired','revoked')),
  version                   int NOT NULL DEFAULT 1,
  subject                   text,
  message                   text,
  internal_note             text,                              -- NEVER shown on the public page
  expires_at                timestamptz,
  sent_at                   timestamptz,
  opened_at                 timestamptz,
  responded_at              timestamptz,
  response_comment          text,
  estimated_completion_date date,
  created_by                text,
  revoked_at                timestamptz,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS order_approval_token_idx ON order_approval_requests (token_hash);
CREATE INDEX IF NOT EXISTS order_approval_order_idx ON order_approval_requests (order_id, created_at DESC);
CREATE INDEX IF NOT EXISTS order_approval_status_idx ON order_approval_requests (tenant_id, status);

CREATE TABLE IF NOT EXISTS order_approval_attachments (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid NOT NULL,
  approval_request_id  uuid NOT NULL REFERENCES order_approval_requests(id) ON DELETE CASCADE,
  attachment_id        uuid NOT NULL REFERENCES order_attachments(id) ON DELETE CASCADE,
  display_order        int NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS order_approval_attachment_uniq ON order_approval_attachments (approval_request_id, attachment_id);

ALTER TABLE order_approval_requests    ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_approval_attachments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Tenant order_approval_requests access" ON order_approval_requests;
CREATE POLICY "Tenant order_approval_requests access" ON order_approval_requests FOR ALL USING (tenant_id = get_tenant_id()) WITH CHECK (tenant_id = get_tenant_id());
DROP POLICY IF EXISTS "Tenant order_approval_attachments access" ON order_approval_attachments;
CREATE POLICY "Tenant order_approval_attachments access" ON order_approval_attachments FOR ALL USING (tenant_id = get_tenant_id()) WITH CHECK (tenant_id = get_tenant_id());

-- ── Reverse (down) ───────────────────────────────────────────────────────────────────────────────────
-- DROP TABLE IF EXISTS order_approval_attachments, order_approval_requests CASCADE;
