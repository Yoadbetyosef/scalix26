-- ============================================================================
-- Landed cost — Phase 1d: `draft` products, created from invoice lines.
--
-- A business setting up from scratch has no catalogue and a stack of supplier invoices. The invoices
-- ARE the catalogue — they are the only record of what was bought. So an unmatched invoice line needs
-- to be able to become a product, carrying its cost, leaving only a selling price to add later.
--
-- ── THE STATE THAT HAD TO EXIST FIRST ───────────────────────────────────────────────────────────────
--
-- A product created this way is real, was paid for, and has a cost — but it has NO SELLING PRICE, so it
-- cannot be quoted. Before this migration there was no way to say that. `catalog_products.status` held
-- active / inactive / discontinued, and lib/catalog/retrieval.ts — the surface the VOICE AGENT reads —
-- filters only `status <> 'discontinued'`. So `inactive` is spoken to callers, and `discontinued` is a
-- lie about goods that just arrived.
--
-- Without a fourth state, creating 133 products from one invoice would put 133 unpriced products in
-- front of a live phone agent, which would tell a caller "yes, we stock that" and have no price to
-- quote. That is the worst failure this feature could produce, and it is customer-facing.
--
-- ── WHY A STATUS VALUE AND NOT A BOOLEAN ────────────────────────────────────────────────────────────
--
-- `status` already answers "is this a live product?". A `sellable` boolean would open a second axis
-- that can contradict the first — draft AND discontinued? — and force every reader to consult two
-- columns to answer one question.
--
-- The deciding argument is which way each fails. Every existing `.eq('status','active')` query excludes
-- 'draft' automatically, with no edit: fail-CLOSED. A boolean leaves all of those queries returning
-- drafts until someone finds and updates each one, and the ones missed are silent.
--
-- The word is also already in this codebase for exactly this idea: lib/studio/types.ts has had
-- STUDIO_PRODUCT_STATUSES = ['active','draft','archived'] since the studio module shipped.
--
-- ── THE ASYMMETRY, WHICH IS THE POINT ───────────────────────────────────────────────────────────────
--
--   The AGENT must NOT see drafts   →  retrieval.ts excludes them.
--   The MATCHER must see drafts     →  lib/invoices/match.ts is WIDENED to include them.
--
-- That second half is not an oversight to be tidied up later. If drafts were unmatchable, the next
-- invoice from the same supplier would create a second copy of all 133 products — the precise failure
-- creating them was meant to end.
--
-- What is deliberately NOT changed: how `inactive` behaves for the agent. It is surfaced to callers
-- today; whether it should be is a separate decision affecting existing tenants, and it must not ride
-- along inside this one.
--
-- Additive, idempotent. Run AFTER add_landed_cost_invoices_3.sql.
-- ============================================================================

-- ── `draft`: in the catalogue, not yet sellable ─────────────────────────────────────────────────────
--
-- Constraint name discovered rather than assumed: the original was created inline, so its generated
-- name is Postgres's business. Same approach as add_variant_costs.sql.
DO $$
DECLARE c record;
BEGIN
  FOR c IN
    SELECT con.conname
      FROM pg_constraint con
      JOIN pg_class rel ON rel.oid = con.conrelid
     WHERE rel.relname = 'catalog_products'
       AND con.contype = 'c'
       AND pg_get_constraintdef(con.oid) ILIKE '%status%'
       AND pg_get_constraintdef(con.oid) ILIKE '%discontinued%'
  LOOP
    EXECUTE format('ALTER TABLE catalog_products DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

ALTER TABLE catalog_products ADD CONSTRAINT catalog_products_status_check
  CHECK (status IN ('active', 'inactive', 'discontinued', 'draft'));

COMMENT ON COLUMN catalog_products.status IS
  'active | inactive | discontinued | draft. `draft` means the product exists and has a cost but no selling price, so it must never be quoted: lib/catalog/retrieval.ts excludes it from everything the voice agent can say. It IS matchable by supplier invoices (lib/invoices/match.ts) so a repeat invoice updates it instead of creating a duplicate. Promotion out of draft is an explicit act — never automatic on a price appearing, because a bulk price import would otherwise put every draft in front of a live phone agent at once.';

-- ── `created`: this line did not match a product, it MADE one ───────────────────────────────────────
--
-- Distinct from 'manual', which is the owner picking an existing product from a shortlist. A created
-- line's match is true by construction rather than chosen, the screen says so, and rematch() must leave
-- it alone exactly as it already leaves 'manual' alone.
ALTER TABLE supplier_invoice_lines DROP CONSTRAINT IF EXISTS supplier_invoice_lines_match_method_check;
ALTER TABLE supplier_invoice_lines ADD CONSTRAINT supplier_invoice_lines_match_method_check
  CHECK (match_method IS NULL OR match_method IN ('exact_sku', 'normalized_sku', 'name_trigram', 'manual', 'created'));

-- ── Reverse (down) ──────────────────────────────────────────────────────────────────────────────────
-- Both CHECKs must be narrowed BEFORE any row still holds the removed value, or the ALTER fails:
--   UPDATE catalog_products SET status = 'inactive' WHERE status = 'draft';
--   UPDATE supplier_invoice_lines SET match_method = 'manual' WHERE match_method = 'created';
-- then re-add the original constraints. Note the first line makes every draft VISIBLE TO THE VOICE
-- AGENT again, unpriced — revert lib/catalog/retrieval.ts in the same change or do not revert at all.
