// THE EIGHTEEN CATEGORIES, AND WHERE EACH ONE LANDS ON A TAX FORM.
//
// Isomorphic — no server imports — so the picker, the list and the export all read one list. A second
// copy is how "fuel" and "Fuel" become two categories.
//
// ── THE OWNER NEVER SEES A LINE NUMBER ──────────────────────────────────────────────────────────
//
// `label` is what appears on screen. `scheduleC` and `t2125` exist for the CSV and nowhere else:
// somebody photographing a petrol receipt is not filling in a tax return, and a form number beside the
// field would make a thirty-second job look like one. The accountant reading the export is a different
// person with a different question, and they get the numbers.
//
// ── AND THERE IS NO 'other' ─────────────────────────────────────────────────────────────────────
//
// Deliberate, and enforced by the database as well as by this list. A receipt that fits nothing means
// the list is missing something — which is worth hearing — where an 'other' bucket absorbs exactly
// that signal and turns it into a row nobody can file. The escape hatch is the note, which a human
// reads.
//
// ── WHERE THE TWO FORMS DISAGREE ────────────────────────────────────────────────────────────────
//
// `scheduleC` is the US Form 1040 Schedule C line; `t2125` is the Canadian equivalent. Neither is
// null: everything here is filable in both countries. What differs is HOW:
//
//   • Some map to a general "other expenses" line on one form — software on both, delivery for a US
//     filer. That is where the form itself puts them, not a gap in this list.
//   • materials and contract_labour land in COST OF GOODS on the Canadian form rather than the
//     expense section. `t2125Section` says so, because an export that listed them beside the others
//     would be quietly wrong about which part of the return they belong to.
//
// Reasoned from the forms rather than from anything in this repository, and worth an accountant's eye
// before a first year end.

/** Which part of T2125 a category files under. Expenses is Part 4; cost of goods is Part 3. */
export type CaSection = 'expenses' | 'cost_of_goods'

export interface Category {
  /** Stored in expenses.category. Stable — renaming a label must never restate history. */
  key: string
  /** What the owner sees. Plain English, no form vocabulary. */
  label: string
  /** A half-sentence for the picker, where the label alone could be read two ways. */
  hint?: string
  /** US Form 1040 Schedule C. 'Other expenses' where the form has no dedicated line. */
  scheduleC: string
  /** Canadian T2125. */
  t2125: string
  /** Part 4 unless stated. See the header — two categories are not expenses in Canada. */
  t2125Section?: CaSection
}

export const CATEGORIES: Category[] = [
  { key: 'advertising',        label: 'Advertising',           scheduleC: '8 — Advertising',                t2125: '8521 — Advertising' },
  { key: 'vehicle_fuel',       label: 'Vehicle & fuel',        hint: 'petrol, servicing, the van',
    scheduleC: '9 — Car and truck expenses',                    t2125: '9281 — Motor vehicle expenses' },
  { key: 'insurance',          label: 'Insurance',             scheduleC: '15 — Insurance',                 t2125: '8690 — Insurance' },
  { key: 'interest_bank',      label: 'Interest & bank fees',  hint: 'loan interest, card and account charges',
    // Coarser than Schedule C, which puts interest on 16 and leaves bank fees to the general line.
    // Canada has the single combined line, so this follows the form that names both.
    scheduleC: '16 — Interest (bank fees to 27a)',              t2125: '8710 — Interest and bank charges' },
  { key: 'legal_professional', label: 'Legal & professional',  hint: 'solicitor, accountant, consultant',
    scheduleC: '17 — Legal and professional services',          t2125: '8860 — Professional fees' },
  { key: 'office',             label: 'Office supplies',       scheduleC: '18 — Office expense',            t2125: '8811 — Office stationery and supplies' },
  { key: 'rent_premises',      label: 'Rent — premises',       hint: 'the shop, the unit, the yard',
    // Split because Schedule C splits it. Canada has one Rent line, so both halves collapse into it
    // harmlessly — where a merged category could never be pulled back apart for a US filer.
    scheduleC: '20b — Rent or lease: other business property',  t2125: '8910 — Rent' },
  { key: 'rent_equipment',     label: 'Rent — equipment',      hint: 'plant, tools, a leased vehicle',
    scheduleC: '20a — Rent or lease: vehicles, machinery, equipment', t2125: '8910 — Rent' },
  { key: 'repairs',            label: 'Repairs & maintenance', scheduleC: '21 — Repairs and maintenance',   t2125: '8960 — Repairs and maintenance' },
  { key: 'materials',          label: 'Materials & supplies',  hint: 'stock and parts you fit or resell',
    // COST OF GOODS in Canada, not an expense. T2125's 8811 is office stationery only.
    scheduleC: '22 — Supplies',                                 t2125: '8320 — Purchases (cost of goods)', t2125Section: 'cost_of_goods' },
  { key: 'taxes_licences',     label: 'Taxes & licences',      hint: 'trade licence, permits, business rates',
    // Schedule C has one line; Canada splits property tax onto 9180. A filer with premises they own
    // moves that half by hand, which is visible in the export rather than silently merged.
    scheduleC: '23 — Taxes and licenses',                       t2125: '8760 — Business taxes, licences and memberships' },
  { key: 'travel',             label: 'Travel',                hint: 'fares, hotels, parking away from base',
    scheduleC: '24a — Travel',                                  t2125: '9200 — Travel expenses' },
  { key: 'meals',              label: 'Meals',                 hint: 'usually only half is deductible',
    // MEALS, never "meals and entertainment". The US removed entertainment deductibility in 2018 and
    // a combined label here would invite a claim that gets disallowed.
    scheduleC: '24b — Deductible meals',                        t2125: '8523 — Meals and entertainment' },
  { key: 'utilities',          label: 'Utilities',             hint: 'power, water, phone, broadband',
    scheduleC: '25 — Utilities',                                t2125: '9220 — Utilities' },
  { key: 'software',           label: 'Software & subscriptions',
    // On NEITHER form as its own line. Kept anyway: it is one of the things an owner actually names
    // when asked what they spend on, and burying it inside "Office" makes the report worse for the
    // person keeping it in exchange for nothing.
    scheduleC: '27a — Other expenses',                          t2125: '9270 — Other expenses' },
  { key: 'delivery_freight',   label: 'Delivery & freight',    hint: 'postage and carriage you pay',
    scheduleC: '27a — Other expenses',                          t2125: '9275 — Delivery, freight and express' },
  { key: 'wages',              label: 'Wages — employees',     hint: 'people on your payroll',
    // SPLIT FROM CONTRACT LABOUR, and this is the split that matters. The US treats them as different
    // legal relationships — W-2 against 1099 — and misclassification carries penalties. Canada puts
    // salaries on one line and subcontracts in cost of goods. Combining the two would be cheap here
    // and expensive for the filer.
    scheduleC: '26 — Wages',                                    t2125: '9060 — Salaries, wages and benefits' },
  { key: 'contract_labour',    label: 'Contract labour',       hint: 'subcontractors and freelancers',
    scheduleC: '11 — Contract labor',                           t2125: '8360 — Subcontracts (cost of goods)', t2125Section: 'cost_of_goods' },
]

/** Every key, in the order the picker shows them. Mirrors expenses_category_check. */
export const CATEGORY_KEYS: string[] = CATEGORIES.map((c) => c.key)

export const categoryByKey = (key: string | null | undefined): Category | null =>
  (key ? CATEGORIES.find((c) => c.key === key) ?? null : null)

/**
 * The label, or the raw key if the database holds something this list does not.
 *
 * That should be impossible — the check constraint is the same eighteen — but a screen that renders
 * blank for an unknown category hides the disagreement, where showing the key makes it obvious which
 * of the two moved.
 */
export const categoryLabel = (key: string): string => categoryByKey(key)?.label ?? key
