-- A discount on the whole invoice, chosen as a PERCENT or a dollar AMOUNT (lib/core/documents.ts
-- setDraftDiscount). The cents still live in invoices.discount_cents / sales_document_lines.discount_cents;
-- these two columns only remember what was chosen, so the customer's copy can print "Discount (10%)".
-- Both null = no discount, and nothing about a discount appears on the invoice.
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS discount_kind text
  CHECK (discount_kind IS NULL OR discount_kind IN ('percent', 'amount'));
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS discount_value numeric(12,2)
  CHECK (discount_value IS NULL OR discount_value >= 0);
