-- ============================================================================
-- EXPENSES — money leaving that is not a supplier invoice.
-- Run in the Supabase SQL editor. Idempotent; safe to re-run.
--
-- Payroll, rent, insurance, fuel, software, shipping. None of it is a supplier
-- invoice, and until now none of it was anything: 219 tables and not one place a
-- tenant could record it. The accountant report shows Money out as supplier
-- bills only, so a locksmith who buys no stock sees $0 — which is true of the
-- data and false about the business.
--
-- ── THE CATEGORY IS A FIXED LIST, AND THERE IS NO "OTHER" ──────────────────
--
-- The accountant's job is to put every dollar on a numbered line of a tax form.
-- Free text moves that work to the person who did not see the receipt, at year
-- end, at their hourly rate — and makes the export ungroupable, because "fuel",
-- "Fuel", "gas" and "Shell" are four categories.
--
-- A tenant-extensible list produces the same result one tenant at a time. That
-- experiment has already run here: `tenants.industry` is a fixed ten with an
-- escape hatch, and 13 of 33 tenants sit in 'Other' with 8 more null. Twenty-one
-- of thirty-three unclassified.
--
-- So: no 'other'. A receipt that fits nothing means the LIST is missing
-- something, which is a thing worth hearing. The escape hatch is `note`, which
-- a human reads.
--
-- ── THE LINE NUMBERS ARE NOT HERE, AND NOT IN THE UI ───────────────────────
--
-- The column stores a stable key. The owner sees "Vehicle & fuel"; somebody
-- photographing a petrol receipt should not be looking at a tax form. The
-- mapping to Schedule C and T2125 lives in code and appears only in the CSV,
-- where the accountant is the reader.
--
-- ── WHY BOTH FORMS, RATHER THAN THE TENANT'S OWN ───────────────────────────
--
-- Because the tenant's country is NOT KNOWABLE. There is no `country` column;
-- 3 of 33 tenants have a `state` at all; and the one Canadian tenant reads
-- state='bc' with timezone='America/New_York', so neither field infers it and
-- timezone would actively get it wrong. The export therefore carries BOTH line
-- numbers as separate columns and neither accountant has to guess. Adding a
-- country field later narrows the export; it does not invalidate a single row.
--
-- ── WHERE THE FORMS DISAGREE, AND WHY THE LIST IS SHAPED THIS WAY ──────────
--
-- Reasoned from the forms, not from this codebase — worth a second opinion from
-- an actual accountant before the first year end.
--
--   wages vs contract_labour   SPLIT, and this is the one that matters. The US
--                              treats them as different lines because they are
--                              different legal relationships (W-2 vs 1099) and
--                              misclassification carries penalties. Canada puts
--                              salaries on one line. Combining them would be
--                              cheap here and expensive for a US filer.
--   rent_premises / rent_equipment  SPLIT because the US splits them. Canada has
--                              a single Rent line, so both collapse there. The
--                              split is losslessly collapsible; the merge is not
--                              recoverable.
--   software                   Appears on NEITHER form as its own line. It maps
--                              to a general/other expense line on both. Kept as
--                              its own category anyway, because it is one of the
--                              six things the owner actually named and burying
--                              it in "Office" makes the report less useful to
--                              the person keeping it.
--   delivery_freight           An explicit Canadian line. The US folds it into
--                              other/cost of goods. Kept, for the same reason.
--   meals                      Meals only, never "meals and entertainment" —
--                              the US removed entertainment deductibility in
--                              2018 and a combined label would invite a
--                              disallowed claim.
--   interest_bank              One category. Canada has a single "interest and
--                              bank charges" line; the US splits interest out
--                              and leaves bank fees to a general line, so this
--                              is the coarser of the two and the export says so.
--   materials, contract_labour Both map to a line in a DIFFERENT SECTION of the
--                              Canadian form — cost of goods rather than
--                              expenses. Mappable, but the export must not imply
--                              they sit beside the others.
--
-- Nothing in the list is unmappable. Two categories (software, and delivery for
-- a US filer) land on a general "other expenses" line, which is where the form
-- itself puts them.
--
-- ── AND THE PART THAT IS NOT ABOUT CATEGORIES AT ALL ───────────────────────
--
-- Canada's real divergence is not which line an expense goes on. It is that the
-- TAX ON THE EXPENSE IS RECOVERABLE. See tax_cents on the table — that column is
-- the only thing here that could not have been added later without re-reading
-- every receipt.
-- ============================================================================

CREATE TABLE IF NOT EXISTS expenses (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,

  -- The date on the receipt, not the date it was typed. An expense entered in
  -- March for a February petrol stop belongs in February.
  spent_on      date NOT NULL,
  merchant      text NOT NULL,
  -- Integer cents, like every other money column here. A float would put
  -- rounding drift into a tax return.
  --
  -- THE TOTAL ON THE RECEIPT, in both countries. What differs is what the filer
  -- may deduct — see tax_cents.
  amount_cents  integer NOT NULL,

  -- THE RECOVERABLE TAX INSIDE amount_cents. NULL means "not split", which is
  -- correct for every US row and is the default.
  --
  -- This column is here because of Canada, and it is the one thing about an
  -- expense row that cannot be fixed later without re-reading the paper.
  --
  -- A US filer records the receipt total: sales tax is part of the cost of the
  -- thing. A Canadian GST/HST registrant does not — the tax is an input tax
  -- credit, recoverable against the tax they collect. A $112 receipt in BC is a
  -- $100 expense and $12 of ITC, not a $112 expense. Recording the total as the
  -- expense overstates the deduction AND loses the credit, twice wrong.
  --
  -- TG jewellers is a registrant; her GST/PST handling is already built
  -- (lib/tax/canada.ts). So this is not hypothetical for a tenant that exists.
  --
  -- Kept OUT of amount_cents rather than net-of-tax, because the number a person
  -- reads off a receipt is the total, and a field that disagrees with the paper
  -- in front of them is a field they will fill in wrong.
  tax_cents     integer,

  currency      text NOT NULL DEFAULT 'usd',
  category      text NOT NULL,
  note          text,

  -- The scan, in the EXISTING supplier-invoices bucket. Private, 20MB, and it
  -- already accepts pdf/png/jpeg/webp, which is what a receipt is. A second
  -- bucket would mean a second set of MIME rules, a second size limit and a
  -- second signed-URL helper to keep in step. The name becomes slightly wrong;
  -- that is cheaper than the divergence.
  --
  -- It is PROOF, not input. Nothing reads it — extraction is deliberately not
  -- part of this — and the year-end question it answers is "can you produce the
  -- receipt for this", which is unanswerable today.
  receipt_path  text,
  receipt_name  text,

  created_by    uuid,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- A zero is not an expense and a negative is a refund. Refunds are real — a
-- returned part, a cancelled subscription — and they are NOT modelled here on
-- purpose: a negative row in a CSV is something the accountant has to interpret,
-- and "how a refund is recorded" deserves its own decision rather than falling
-- out of a missing constraint.
ALTER TABLE expenses DROP CONSTRAINT IF EXISTS expenses_amount_check;
ALTER TABLE expenses ADD CONSTRAINT expenses_amount_check CHECK (amount_cents > 0);

-- Separately, so a re-run against a table created before tax_cents existed still
-- gets the column. CREATE TABLE IF NOT EXISTS would silently skip it.
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS tax_cents integer;

-- Recoverable tax is a PART of the total, so it cannot equal or exceed it, and a
-- negative one is meaningless. Zero is allowed and is not the same as NULL: zero
-- says "I checked, there was none"; NULL says "not split".
ALTER TABLE expenses DROP CONSTRAINT IF EXISTS expenses_tax_check;
ALTER TABLE expenses ADD CONSTRAINT expenses_tax_check
  CHECK (tax_cents IS NULL OR (tax_cents >= 0 AND tax_cents < amount_cents));

ALTER TABLE expenses DROP CONSTRAINT IF EXISTS expenses_category_check;
ALTER TABLE expenses ADD CONSTRAINT expenses_category_check CHECK (category IN (
  'advertising',      -- Advertising
  'vehicle_fuel',     -- Vehicle & fuel
  'insurance',        -- Insurance
  'interest_bank',    -- Interest & bank fees
  'legal_professional', -- Legal & professional
  'office',           -- Office supplies
  'rent_premises',    -- Rent — premises
  'rent_equipment',   -- Rent — equipment
  'repairs',          -- Repairs & maintenance
  'materials',        -- Materials & supplies
  'taxes_licences',   -- Taxes & licences
  'travel',           -- Travel
  'meals',            -- Meals
  'utilities',        -- Utilities
  'software',         -- Software & subscriptions
  'delivery_freight', -- Delivery & freight
  'wages',            -- Wages — employees
  'contract_labour'   -- Contract labour
));

-- The list's shape, so it is refused rather than absorbed:
--   no 'other', no 'misc', no 'uncategorised'. See the header.

CREATE INDEX IF NOT EXISTS expenses_tenant_date_idx ON expenses (tenant_id, spent_on DESC);
CREATE INDEX IF NOT EXISTS expenses_tenant_category_idx ON expenses (tenant_id, category);

ALTER TABLE expenses ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Tenant expenses access" ON expenses;
CREATE POLICY "Tenant expenses access" ON expenses
  FOR ALL USING (tenant_id = get_tenant_id());

COMMENT ON TABLE expenses IS
  'Money leaving that is not a supplier invoice: payroll, rent, insurance, fuel, software, shipping. Not gated on a module — every business spends, and landed_cost being off is why a locksmith saw $0 for Money out.';
COMMENT ON COLUMN expenses.category IS
  'A stable key from a FIXED list with no "other". The owner sees a plain-English label; the Schedule C and T2125 line numbers live in code and appear only in the CSV. A receipt that fits nothing means the list is missing something.';
COMMENT ON COLUMN expenses.tax_cents IS
  'Recoverable tax inside amount_cents. NULL means not split, which is correct for every US row. Exists because a Canadian GST registrant deducts the expense net and claims the tax as an input credit — recording the receipt total would overstate the deduction and lose the credit.';
COMMENT ON COLUMN expenses.spent_on IS
  'The date on the receipt, never the date it was entered. An expense typed in March for a February petrol stop belongs in February.';
COMMENT ON COLUMN expenses.receipt_path IS
  'Path in the supplier-invoices bucket. PROOF, not input — nothing reads it. It answers "can you produce the receipt", which is unanswerable today.';

-- ── Verify ─────────────────────────────────────────────────────────────────

SELECT column_name, data_type, is_nullable
FROM information_schema.columns WHERE table_name = 'expenses' ORDER BY ordinal_position;

-- Expect three constraints and two indexes.
SELECT conname FROM pg_constraint
WHERE conname IN ('expenses_amount_check', 'expenses_category_check', 'expenses_tax_check');
SELECT indexname FROM pg_indexes WHERE tablename = 'expenses' ORDER BY indexname;

-- The category list as the DATABASE holds it, not as this file claims. Expect 18
-- names and no 'other' anywhere in the text.
SELECT pg_get_constraintdef(oid) AS category_constraint
FROM pg_constraint WHERE conname = 'expenses_category_check';

-- Expect 0 — nothing is created by this migration.
SELECT count(*) AS expenses FROM expenses;

-- The bucket the receipt goes in, unchanged and already suitable.
SELECT id, public, file_size_limit FROM storage.buckets WHERE id = 'supplier-invoices';
