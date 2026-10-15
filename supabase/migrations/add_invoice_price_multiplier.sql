-- Selling price = supplier invoice unit price × multiplier (rugs × their own multiplier).
-- Applied by lib/invoices/store.ts after a shipment is applied; see lib/catalog/pricing.ts.
-- NULL = the tenant prices by hand; nothing is priced automatically.

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS price_multiplier numeric CHECK (price_multiplier > 0),
  ADD COLUMN IF NOT EXISTS rug_price_multiplier numeric CHECK (rug_price_multiplier > 0);

-- Your Design Collective, owner's decision 15 Oct 2026: ×3.2, rugs ×4.
UPDATE tenants SET price_multiplier = 3.2, rug_price_multiplier = 4
WHERE id = '8041c0b5-c960-48bd-a3f7-655f5a0b6434';
