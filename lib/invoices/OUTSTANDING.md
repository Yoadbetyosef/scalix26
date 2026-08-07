# Landed cost from supplier invoices — what's outstanding

Written 6 Aug 2026, at the point Phase 1 was built. Everything below is known-incomplete or
known-unknown. What works is in the code comments and in `add_landed_cost_invoices.sql`.

**State.** Code-complete, build green, lint clean, 376 tests passing. **Nothing has run against a real
database or a real invoice.** Read the first two sections before believing anything else here.

---

## 1. The migration has not been run

`supabase/migrations/add_landed_cost_invoices.sql` is unrun. Every claim about the schema is a claim
about SQL that was written and reasoned over, not executed. The parts most likely to be wrong on first
contact, in order:

- **`WITH updated AS (UPDATE … RETURNING) INSERT INTO … SELECT … WHERE NOT IN (SELECT … FROM updated)`**
  in `apply_shipment_costs`. Data-modifying CTEs are valid and the RETURNING reference is the documented
  way to do this, but this is the single most intricate statement in the file.
- **`ON DELETE SET NULL (product_id)`** — the column-list form, Postgres 15+. Supabase is on 15+, but
  this is the one syntax here that would simply not parse on an older engine.
- **`INSERT INTO storage.buckets`** — creating the bucket from the SQL editor rather than the dashboard.
  Permissions on that table have changed across Supabase versions.
- The three `DO $$ … EXCEPTION WHEN duplicate_table … END $$` blocks around `ADD CONSTRAINT … UNIQUE`,
  which exist only for idempotency.

Run it, then re-read this file.

## 2. No real invoice has ever been extracted

The prompt in `extract.ts` has never met an actual supplier PDF. Unknown until it does:

- Whether the model reliably separates product lines from charge lines. Everything downstream rests on
  this: a freight line mistaken for a product becomes a product that takes a share of its own freight.
- Whether `lineTotal` comes back as printed rather than recomputed. The prompt says not to multiply, and
  `extendedOf()` does the fallback where it is visible — but the instruction is untested.
- Whether `freightTotal` / `dutiesTotal` / `otherTotal` land in the right buckets on invoices that use
  trade vocabulary the prompt does not name (CIF, FOB, "carriage", "despatch").
- What a photograph of an invoice does, as opposed to a PDF. Both are accepted.

Extract one real invoice, read the lines against the paper, before letting a tenant near this.

## 3. Judgement calls with no data behind them

Each of these is a number someone chose, not a number anything measured:

| Constant | Value | Where | Why it might be wrong |
|---|---|---|---|
| `MIN_COVERAGE` | 0.80 | `types.ts` | Blocks apply below 80% matched value. Never tested against a real match rate — if the deterministic ladder typically lands at 60% on real invoices, this becomes a wall the owner overrides every time, which trains them to ignore it. |
| `MAX_INVOICE_PAGES` | 20 | `types.ts` | Chosen from "real invoices are 1–5 pages". Untested against a real furniture container manifest. |
| `NAME_THRESHOLD` | 0.45 | `match-score.ts` | Trigram score below which a name match is refused. |
| `AMBIGUITY_MARGIN` | 0.08 | `match-score.ts` | How far the best name match must beat the runner-up. **Measured — see below.** |
| `MAX_MATCH_CATALOG` | 10,000 | `match.ts` | Above this, only SKUs are matched. |

The first real invoice produces evidence for all five at once. Look at them together, not one at a time.

### `AMBIGUITY_MARGIN` does not measure what it looks like it measures

Measured 6 Aug 2026 against the stage-1 synthetic invoice, using the shipped `similarity()`:

```
query: "Albero Side Table"          (an invoice line with no variant named)
  "Albero Side Table — Oak"      0.7500
  "Albero Side Table — Walnut"   0.6667
  "Albero Side Table — Ash"      0.7500

gap Oak vs Walnut = 0.0833   AMBIGUITY_MARGIN = 0.08   ->  MATCHES Oak, by 0.0033
gap Oak vs Ash    = 0.0000                             ->  refuses, correctly
```

The invoice line does not say which variant it is, so the only correct answer is to refuse and ask. It
refuses for Oak/Ash and matches for Oak/Walnut — and the thing that decides it is **the length of the
variant suffix**, not how confusable the two products are. "Oak" is shorter than "Walnut", so it shares
a higher proportion of trigrams with the unqualified query.

That is the constant not measuring the quantity it is named for. Raising it to 0.10 would fix this one
case and is exactly the wrong response: it would be tuning against a single synthetic example, and the
next catalogue's variant names have different lengths again. What the case actually argues for is a
different SHAPE of check — for instance, refusing when the top candidates share a common stem and
differ only in a trailing qualifier, which is a structural fact rather than a distance.

Do not act on this until it can be seen against real invoices alongside the other four constants. It is
recorded here so the measurement is not re-derived, and so nobody "fixes" it by nudging the number.

### The name rung fires on lines whose SKU matched nothing

Measured 6 Aug 2026 on a real 133-line Primavera invoice (EUR, 37,084). Three separate lines —
`SCATTER CUSHION 45X45`, SKUs **1343095**, **1343109**, **1343122** — all matched the one seeded
product *Linen Scatter Cushion 45x45* at 0.72 each.

Every one of those lines carried a SKU. None of those SKUs is in the catalogue. `bestMatch` tries
exact SKU → normalised SKU → name, and when both SKU rungs miss it falls through to the name rung as
though nothing had been learned.

**That is the bug in the reasoning, not the threshold.** A line carrying a definite SKU that matches
nothing is *evidence the product is not in the catalogue* — the supplier has told us their identifier
for the goods and we do not hold it. Treating that as no evidence, and then matching on a description
that happens to share trigrams with something else, is how three distinct products become one.

The candidate rule: **when a line has a SKU and no SKU rung matches, do not name-match.** Unmatched is
the honest answer, and the owner can still match or create by hand. Like the Oak case above this is a
change of SHAPE rather than a number, and like Oak it should be decided against several real invoices
rather than the one that produced it.

Both findings are the same underlying fault seen twice: the matcher is confident on a *structural
coincidence* — suffix length in Oak's case, shared trigrams in this one — where it has no evidence
about meaning.

## 4. Allocation by value is a proxy, and it will be wrong for some businesses

Freight is apportioned by line extended value. Freight actually correlates with **weight and volume**,
which a supplier invoice does not carry.

For a business shipping goods of broadly similar density this is close enough and is what a bookkeeper
would do. For a business shipping a pallet of cushions and a pallet of marble tops in one container it
is materially wrong, and **no amount of tuning fixes it** — the input needed (weight or volume per
product) does not exist anywhere in the schema.

The UI says the method out loud rather than implying precision. If a tenant hits this, the answer is a
weight column on `catalog_products` and a second allocation basis, not a better proxy.

## 5. N+1 writes on every re-match and re-allocation

`rematch()` and `reallocate()` in `store.ts` both update **one row per PostgREST call**. A 100-line
invoice is 100 round trips per pass, and `reallocate()` runs on every single line edit the owner makes.

Inside a 300s budget this will not fail, but it makes the approval screen feel slow in exactly the
situation it matters — a big invoice with a lot of hand-matching. The fix is one bulk statement (an
RPC taking a jsonb array of `{lineId, freight, duties}`), not a faster loop. Deliberately not built
before there is a real invoice to measure it against.

`suggestProducts()` has the same shape: up to three `ilike` queries per picker opening.

## 6. Untested surfaces

Unit-tested: `allocate.ts` (22 tests, including the EUR-invoice arithmetic and the proof that
converting freight produces a different, wrong number), `match-score.ts` (16). Those are the pure modules, and they hold
the arithmetic and the judgement.

**Not tested at all:** `store.ts`, `match.ts`, `extract.ts`, all five API routes, both pages. These
need a database, a network, or both, and there is no fixture harness in this repo for any of them —
the same gap `lib/catalog/retrieval.ts` has, recorded in `catalog-worker/OUTSTANDING.md`.

The riskiest untested path is `createShipmentFromFile()`'s cleanup: it removes the storage object and
the shipment row on an insert failure, and that unwind has never run.

## 7. Products created from invoice lines

**The SKU stored is the SUPPLIER's, unprefixed.** That is deliberate: it is what makes the next invoice
from that supplier match these rows exactly instead of creating a second copy of all 133. Prefixing
(`PRIM-1343095`) would remove the collision risk and destroy the matching, which is the whole benefit.

Two costs come with it, both accepted:

- **Cross-supplier collision.** Two suppliers using the same numbering scheme would produce two
  products competing for one SKU. Theoretical until there is a second supplier doing it; 133 duplicate
  drafts per repeat invoice is certain. Taken knowingly.
- **Assigning his own SKUs later would break matching.** The moment the tenant renumbers a product to
  their own scheme, that product stops matching its supplier's invoices and the next one creates a
  draft duplicate. There is no second column for a supplier SKU today. If tenants start renumbering,
  that is the fix — not a prefix.

**Quantity is NOT written as stock.** The invoice says twenty were bought; having twenty is a different
fact about a different moment, and belongs in `catalog_movements`. It matters more here than it would
elsewhere: this tenant imports furniture from Europe, and a supplier invoice is issued at SHIPMENT —
the container is at sea for weeks. Auto-receiving would have the voice agent promise a caller a sofa
that is mid-Atlantic.

**Promotion out of `draft` is explicit, never automatic on a price appearing.** A bulk price import
would otherwise put every draft in front of a live phone agent in one action — precisely the failure
the status was added to prevent.

**`inactive` is still surfaced to the voice agent.** `retrieval.ts` excludes `discontinued` and `draft`
only. Whether an inactive product should be quotable is a real question and a separate decision that
affects existing tenants; it was deliberately not changed while adding `draft`.

## 8. Smaller things worth knowing

**`applied_before` records the FIRST apply only.** Re-applying deliberately does not overwrite it, so
the snapshot always describes the world before this shipment ever touched it. That is the right
behaviour for "put it back", but it means the record does not describe the state immediately prior to a
*second* apply. There is no UI that reads it at all yet — it is written and never shown.

**A re-apply after editing the charges is allowed and correct**, but the old allocation on the products
is simply overwritten, not reversed and re-applied. Since a product's `shipping_cost` is fully replaced
rather than incremented, this is right — but it is only right because one product can carry one
shipment's freight at a time. **Two different shipments containing the same product overwrite each
other.** That is the largest known modelling gap in Phase 1.

It is now WARNED but not fixed: `withPriorShipments()` in `store.ts` marks any line whose product
already carries freight from an applied shipment, and the review screen names the earlier shipment, the
amount, and the date on the line itself plus a summary above Apply. It deliberately does not block —
reordering the same goods and wanting the newer freight is the common, correct case. What it removes is
the silent version, where the second apply erases the first and the margin is wrong from then on with
nothing on screen to say why.

The real fix needs a decision Phase 1 does not make: whether a product's landed cost should reflect the
most recent shipment, a weighted average across shipments still in stock, or per-batch costing. Those
are different businesses' answers, not a missing feature.

**Two currencies, and only one of them moves.** Line values convert into base currency at a rate the
owner types on the invoice (`supplier_invoices.exchange_rate`, added in `add_landed_cost_invoices_2.sql`).
Freight and duty never convert, because they never arrive foreign — they come from the freight
forwarder in base currency and are typed from that bill. `apply_shipment_costs` refuses a
foreign-currency invoice with no rate, and refuses freight denominated in anything but base currency.
Neither has an override.

Phase 1 shipped without the rate at all, on a too-broad reading of "a stored rate is a wrong rate" from
`add_product_costs.sql`. That doctrine was written against a TENANT-WIDE rate that goes stale; a rate
typed once on the invoice it was paid on is a historical fact, not a forecast. The gap meant a EUR
invoice produced products with freight, a EUR reference figure, and no landed cost whatsoever.

If a tenant ever gets a forwarder's bill in a foreign currency, that is a second rate on a second
document — NOT this rate applied to one more field.

**A third-currency invoice still writes `cost_primary`** (converted at the typed rate) but leaves
`cost_secondary` null, because there is no labelled field to show an unrecognised currency in. Nothing
is lost — `supplier_invoice_lines` keeps every original figure exactly as extracted.

**The `landed_cost` module now means more than it did.** Turning it on used to mean one combined input
on the cost card; it now also exposes `/landed-cost`. The description in `lib/modules.ts` was updated —
any tenant who had it on before this shipped gained a feature without asking.

**No navigation entry.** `/landed-cost` is routable and module-gated but appears in no sidebar. Reaching
it means typing the URL. Deliberate — it should be placed once someone has used it and knows where it
belongs.
