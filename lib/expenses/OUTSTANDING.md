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

## 3. THE RECEIPT IS READ ONCE, TO FILL THE FORM

Built 18 Aug 2026. The condition this section used to set — *not until somebody has used the manual
path enough to say what is tedious about it* — was met: typing the amount, the merchant and the
category off a receipt already in your hand is the work, and skipping it was the point.

The rule it set was kept. An extracted value is **a suggestion the person confirms**, never a silent
write: nothing saves, the sheet stays live while the model reads, and a reading fills only the fields
nobody has touched. Edit and delete were built **first**, deliberately — a confirmation only means
something if a wrong one can be taken back (§6).

Measured, on `claude-sonnet-5` at `effort: 'low'`, one page:

| | |
|---|---|
| cost | **1.2–1.6¢** a receipt — 3,000–4,700 input tokens, ~90 output. 40 a month ≈ 60¢ |
| time | **3–7s** end to end for the model call; the 1600px read copy is ~200 KB on the wire |
| ceiling | route 30s, client aborts at 20s and falls through to typing |

**What is still unknown is fill rate on real paper.** Everything above was exercised against rendered
receipts and PDFs — crisp text, no creases, no thermal fade, no flash glare, no receipt photographed
at an angle on a car seat. Those are the conditions that decide whether this is worth the tap, and
none of them have happened yet. The first ten real photographs are the measurement; `usage_events`
already records what each one cost.

**The failure that matters, and what was done about it.** A photograph that misses the bottom of a
long receipt is the ordinary case, and the first version of the prompt answered it by promoting a
LINE ITEM to the total — 71.80 on a fuel receipt whose total was 87.99. The number is printed on the
page, which is what makes it dangerous: it arrives pre-filled and looks right. Two rules in the
prompt fix it, and the clause doing the work is *"even when it is the only one you can see"* —
softening it brought 71.80 straight back. See the comment above `PROMPT` before touching that line.

Smaller things deliberately not done:

- **A replaced photo on an EDIT is not read.** Those fields were already checked by a person, and
  rewriting six of them because somebody re-photographed a receipt is the overwrite this design
  exists to prevent. If it is ever wanted, it needs to be an explicit "read this again" action.
- **The currency is read and thrown away.** `expenses.currency` defaults to `usd` and the form has no
  currency field, so a CAD receipt records CAD in the reading and USD in the row. Harmless today —
  `cost_base_currency` is USD for all 33 tenants — and the fix is a currency field, not a silent
  write of whatever the photograph said.
- **The photograph is uploaded twice**: the 1600px copy to be read, the 2000px copy at save. The
  alternative is storing at read time, which needs a reaper for every receipt somebody read and then
  abandoned, and breaks the invariant `createExpense` was built on — the bucket never holds a file
  nothing points at. The second upload sits behind a button the person has already pressed.
- **No prompt caching.** The prompt and schema come to roughly 900 tokens, under Sonnet 5's 1024
  minimum, so a `cache_control` marker there would pay the write premium and never read.

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

- ~~**No edit, no delete.**~~ Built 18 Aug 2026, ahead of extraction and on purpose: extraction fills
  fields from a photograph and asks a person to confirm them, and a confirmation is only meaningful
  if a wrong one can be taken back. Tapping a row opens the same sheet that added it.
  What that leaves open: **no history.** An edit overwrites, so there is no record that the amount
  used to be something else, and a delete is a delete. Fine while one person keeps their own books;
  the day two people share a workspace, "who changed this and when" becomes a real question and the
  answer is a separate table, not a flag on this one.
- **Currency is per-row and defaults to `usd`,** but the screen reads the currency off the first row
  and formats every row with it. A tenant with mixed currencies would be shown one symbol over two
  currencies. No tenant has mixed currencies today; `cost_base_currency` is USD for all 33.
- **`taxSignals` runs two queries on every page load** and is deliberately not cached. Fine at
  current volume. Noted because the obvious optimisation — caching it — is the one that would show a
  tax box to a business that has none.
- **The month grouping uses UTC.** A receipt dated the 1st or the 31st could group into a neighbouring
  month for a tenant far from UTC. All tenants are `America/*`, so this is real but has not bitten.
