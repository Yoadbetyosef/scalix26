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
| `AMBIGUITY_MARGIN` | 0.08 | `match-score.ts` | How far the best name match must beat the runner-up. |
| `MAX_MATCH_CATALOG` | 10,000 | `match.ts` | Above this, only SKUs are matched. |

The first real invoice produces evidence for all five at once. Look at them together, not one at a time.

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

Unit-tested: `allocate.ts` (18 tests), `match-score.ts` (16). Those are the pure modules, and they hold
the arithmetic and the judgement.

**Not tested at all:** `store.ts`, `match.ts`, `extract.ts`, all five API routes, both pages. These
need a database, a network, or both, and there is no fixture harness in this repo for any of them —
the same gap `lib/catalog/retrieval.ts` has, recorded in `catalog-worker/OUTSTANDING.md`.

The riskiest untested path is `createShipmentFromFile()`'s cleanup: it removes the storage object and
the shipment row on an insert failure, and that unwind has never run.

## 7. Smaller things worth knowing

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

**Currency is guarded, not converted.** `apply_shipment_costs` refuses when the shipment's currency is
not the tenant's base currency, and the screen says so before Apply. There is deliberately no FX
anywhere — the owner re-types the figure in base currency. If tenants find that annoying, the answer is
still not a stored rate.

**A third-currency invoice writes no unit cost.** If the invoice is in neither the base nor the declared
secondary currency, `cost_primary` and `cost_secondary` are both left alone; freight and duty still
land. `computed_cost` then stays NULL and the margin reads blank, which is honest but may look broken.

**The `landed_cost` module now means more than it did.** Turning it on used to mean one combined input
on the cost card; it now also exposes `/landed-cost`. The description in `lib/modules.ts` was updated —
any tenant who had it on before this shipped gained a feature without asking.

**No navigation entry.** `/landed-cost` is routable and module-gated but appears in no sidebar. Reaching
it means typing the URL. Deliberate — it should be placed once someone has used it and knows where it
belongs.
