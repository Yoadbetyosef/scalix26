# Expenses — what's outstanding

Written 17 Aug 2026, at the point the record and the add screen were built. Everything below is
known-incomplete or a decision deliberately deferred. What works is in the code comments and in
`supabase/migrations/add_expenses.sql`.

**State, 17 Aug 2026.** Migration run. Table live, 0 rows. `/v2/expenses` and `POST /api/expenses`
built and building; gates green (tsc 0, vitest 1631, build 0). **Nothing has been entered through the
screen against a real tenant yet** — the reader, the upload and the downscale have not been exercised
by a person with a phone. That is the next thing to do, before the export.

---

## 1. REFUNDS ARE NOT MODELLED — the deliberate one

`amount_cents > 0` at the database, and `parseExpense` refuses zero and negative before that. So a
returned part, a cancelled subscription, a credit from a supplier, or a duplicate charge reversed has
**nowhere to go**.

This is a decision, not an omission. A negative row in a CSV is something the accountant has to
interpret — is it a refund of an expense in this period, a credit note against a bill, or a data
entry error? — and the answer changes which line of the return it lands on. Letting it arrive by
accident, through the absence of a constraint, would mean nobody ever chose.

**The shapes it could take**, when it is decided:

- A negative `amount_cents` on the same table. Cheapest. Makes every SUM correct for free. Makes the
  list show a negative row that reads like a bug, and makes "total spent" ambiguous.
- A `refunds` table pointing at the expense being refunded. Truthful about what a refund IS, and the
  only shape that can express a partial refund of a specific receipt. Most work.
- A `kind` column — `expense` | `refund` — with the amount staying positive. Middle ground. Reads
  well in a list and in an export; needs every consumer to remember the sign.

My preference is the third, but it should be chosen with a real refund in hand rather than in the
abstract. **Symptom to watch for:** somebody recording a refund as a negative-looking note, or as an
expense they then ask to delete.

## 2. THE CSV EXPORT IS NOT BUILT

The next commit. It is what `categories.ts` carries `scheduleC` and `t2125` for — neither string is
used by anything today, which will look like dead code until the export exists.

Two things it has to get right that are already decided in the data:

- **Both forms, side by side.** The tenant's country is not knowable (see §4), so the export carries a
  Schedule C column AND a T2125 column and neither accountant guesses.
- **`t2125Section`.** `materials` and `contract_labour` file under cost of goods in Canada, not the
  expense part. An export that lists them beside the others is quietly wrong about the section.
- **A Net column** derived from `amount_cents - tax_cents`, and only where `tax_cents` is non-null.

## 3. NOTHING READS THE RECEIPT, ON PURPOSE

The file is proof, not input. `lib/invoices/extract.ts` exists and could read one — it is structured
outputs against `INVOICE_SCHEMA`, and a till receipt is well within what it handles. It is not wired
in, and should not be until somebody has actually used the manual path enough to say what is tedious
about it.

If it is wired in later, the thing to preserve: an extracted amount must be **shown as a suggestion
the person confirms**, never written silently. The screen currently makes no claim to have read
anything, which is honest and is worth not losing.

## 4. THE TENANT'S COUNTRY IS INFERRED, NOT KNOWN

Measured 17 Aug 2026: `tenants` has address/city/state/zip and **no `country` column**; 3 of 33
tenants have a `state` at all (`bc`, `NJ`, `New York`); every timezone is `America/*`; the one
Canadian tenant reads `state='bc'` with `timezone='America/New_York'`.

So `recoversTaxOnExpenses` infers from two narrow signals — a Canadian province code, or any order
carrying a `delivery_province`. Both are things a tenant has already told us by working.

**If a `country` column is ever added**, this function is where it goes, and it should be an override
rather than a replacement: a tenant who set their country is answered from it, everybody else keeps
the inference. Nothing about the stored rows changes — that is what the nullable `tax_cents` bought.

## 5. NOT YET EXERCISED BY A PERSON

Specifically untested against reality:

- **The downscale on a real iPhone.** `createImageBitmap` on a HEIC works in Safari and does not in
  Chrome; the code falls back to the original file and lets `receiptFileError` refuse it in words.
  That fallback path has never run on a real device.
- **The 3.5 MB ceiling.** Chosen below Vercel's ~4.5 MB with room for the form fields sharing the
  body. Not measured against an actual multipart request with a long note attached.
- **`canViewCosts`.** Expenses are gated on it, like supplier invoices — rent and payroll are more
  private than stock costs, not less. No White Label operator session has tried to open the screen.

## 6. SMALL AND KNOWN

- **No edit, no delete.** A typo means a wrong row that stays. This is the most likely first
  complaint.
- **Currency is per-row and defaults to `usd`,** but the screen reads the currency off the first row
  and formats every row with it. A tenant with mixed currencies would be shown one symbol over two
  currencies. No tenant has mixed currencies today; `cost_base_currency` is USD for all 33.
- **`taxSignals` runs two queries on every page load** and is deliberately not cached. Fine at
  current volume. Noted because the obvious optimisation — caching it — is the one that would show a
  tax box to a business that has none.
- **The month grouping uses UTC.** A receipt dated the 1st or the 31st could group into a neighbouring
  month for a tenant far from UTC. All tenants are `America/*`, so this is real but has not bitten.
