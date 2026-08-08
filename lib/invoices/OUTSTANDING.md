# Landed cost from supplier invoices — what's outstanding

Written 6 Aug 2026, at the point Phase 1 was built. Everything below is known-incomplete or
known-unknown. What works is in the code comments and in `add_landed_cost_invoices.sql`.

**State, 7 Aug 2026 (end of day).** Build green, 501 tests passing. All migrations run except the one
named in §0. Two real invoices extracted, matched and applied against production; 206 real cost rows
written and verified. **The header sentence that used to sit here — "nothing has run against a real
database or a real invoice" — was true on 6 Aug and is now obsolete; §1 and §2 below are kept for the
reasoning they record, not as a description of today.**

Read §0 first. It is the resume point.

---

## 0. WHERE THIS STANDS — read this first

Written 7 Aug 2026 so this does not have to be reconstructed from a chat thread.

### 0a. Done and verified

- Supplier invoice → shipment → allocation → apply, end to end, against production.
- Two shipments applied for Your Design Collective: **PRIMAVERA 866/4/2026** (126 products) and
  **B&N BN-1356** (80). All 206 `product_costs` rows carry `commission_percent = 25`.
- Freight allocation verified uniform per shipment: B&N **44.6815%** ideal, actual 44.6615–44.7173%;
  max rounding on any line **half a cent**; allocation totals to charges exactly. The deviation
  signature is the proof — the largest deviations are all the smallest lines, which is what rounding
  looks like and is not what a bug looks like.
- Migrations applied: `add_landed_cost_invoices` 1–5, `add_catalog_retrieval` 2–3, `add_cost_commission`.
- `CATALOG_RETRIEVAL_TIMEOUT_MS = 450` set on Vercel Production **and** Preview. Note for next time: a
  branch-scoped variable cannot be widened to Production — Vercel errors with *"Environment Variables
  with gitBranch can only be used with target=preview"* — so it must be deleted and recreated.

### 0b. PENDING migration — one

`supabase/migrations/correct_divergence_ack_2026_08_07.sql`. Corrects the false acknowledgement
described in §7i. Idempotent, no down statement. Nothing else is unrun.

### 0c. The merge sequence — steps 1–3 done, 4–7 outstanding

`feat/landed-cost-invoices` is **not merged**. `main` is at `02cd45a` (the payment-link fix) and does
not contain this feature at all.

| # | Step | State |
|---|---|---|
| 1 | Disable auto-deploy on the Railway production voice-server (`scalix26`, root `/voice-server`, watching `main`) | **DONE** — "Auto deploy is disabled" |
| 2 | `CATALOG_RETRIEVAL_TIMEOUT_MS = 450` on Production + Preview | **DONE** |
| 3 | ~~Delete the diagnostic 2000ms preview var~~ — superseded: the var was deleted and recreated at 450 for both targets | **DONE** |
| 4 | One partial-match test call | **OUTSTANDING** |
| 5 | Merge to `main` | OUTSTANDING |
| 6 | Deploy voice-server manually (auto-deploy is off, so this will NOT happen on merge) | OUTSTANDING |
| 7 | Revert YDC's Twilio webhook off the branch service | OUTSTANDING |

**Step 4, ready to run.** Call Smith HVAC and say, verbatim:

> **"Do you have a princess solitaire platinum ring in size seven?"**

Verified against the live catalog on 7 Aug: tokenises to five terms
(`solitaire > princess > platinum > ring > size`; the "7" is dropped as a single character). Rung 1,
all five ANDed → **0 rows**. Rung 2, dropping "size" → **60 rows**. So it exercises the partial-match
sentence against a real 9,279-row catalog rather than a synthetic one.

Smith HVAC is the right tenant despite the name: naturesparkle.com is connected to it as a **website**
source, so its 9,279 rows live in `catalog_ingested_products`, and partial matching covers that table
— `searchWebsite` and `searchInventory` call the same `ladder()`, and `keptTokens = max(w.kept,
i.kept)`, so a website-only hit at a narrower rung sets `partial`.

### 0d. Parked from the catalog/voice work

- **The ladder's length proxy is wrong, and now demonstrably so.** `byDistinctiveness` sorts by string
  length, so the rung drops the SHORTEST token, not the least distinctive one. Confirmed 7 Aug against
  the real catalog: `ladder()`'s own comment cites *"pear shaped diamond ring"* as the phrase the floor
  fix rescued, and that phrase **still returns nothing at both rungs**, because the junk word
  ("shaped") is not the shortest one ("ring" is). Filed as **recall, not performance**. The comment is
  inaccurate and should be corrected in the same change. Related: §1b, the Oak/Walnut suffix-length
  finding — the same fault, that a structural coincidence is being read as evidence.
- **Keyterm coverage sits ~3 points above the disabled threshold** (`MIN_KEYTERM_COVERAGE = 0.5`,
  `KEYTERM_WORD_BUDGET = 350` in `lib/catalog/terms.ts`). That is a thin margin: a catalogue with
  slightly more common words tips to `disabled` and the whole feature silently stops helping. **Do not
  relax the distinctiveness filter to raise coverage** — that was considered and rejected; the filter
  is what makes the terms worth sending. If the margin needs widening, the budget is the lever.
- **Per-stage timings were instrumented and never read.** `catalog_retrieval_log.stages` (added in
  `add_catalog_retrieval_3.sql`) has been collecting per-rung milliseconds since 7 Aug. The ~150ms per
  rung remains unexplained, and 450ms was chosen without this data. Read it before tuning again.
- **Embeddings: undecided.** Raised as the alternative layer to keyterms + phonetic matching, and
  deliberately not chosen — keyterms were built first because they were measurable. Still open, and
  the honest position is that nothing has been measured that would justify the cost.
- **`/api/voice/*` namespace.** Logged as the eventual shape for the voice endpoints so the middleware
  allowlist stops being a per-route decision. Not started.

### 0e. Data problems in YDC's catalogue

- **Two zero-cost rows** — the B&N `SET OF CUSHIONS` lines, invoiced at 0.00 EUR because the cushions
  are included in the price of the chair. Product ids `7d7defea…` and `a1b4a036…`. They show $0.00
  landed cost and 100% margin. Wrong on screen, untouched by the commission backfill, and already wrong
  before it. See §7f for the two questions to settle first — whether a bundled line should be a product
  at all, and what the card shows if it should.
- **203 of the 206 affected products are drafts with no price.** That is the draft mechanism working,
  and it is why the commission backfill needed almost no price review: exactly **one** product on both
  shipments has a selling price (BERNARD DINING ARMCHAIR, $650, margin 52.4% → 44.2%). When those
  drafts are priced, they will be priced from the corrected commission-inclusive cost, which is the
  right order.

### 0f. BUSINESS-BLOCKING, not technical

These cannot be solved in this repository and are waiting on decisions outside it.

- **Twilio second-account reconciliation.** The numbers and the approved messaging brand are not all in
  one account. Until that is reconciled, A2P registration cannot proceed cleanly. **Parked
  deliberately**, not forgotten.
- **The approved brand is SOLE_PROPRIETOR.** That carries throughput limits a Standard Business Brand
  would not, and it constrains what SMS volume the platform can promise. A business decision about
  which entity registers, not a code change.

### 0g. Platform limits worth remembering

- **Uploads cap at 4.5 MB**, measured (§7d), not read off a doc page. A **6.3 MB** invoice failed at
  Vercel's edge with `FUNCTION_PAYLOAD_TOO_LARGE`, and the client surfaced it as
  `Unexpected token 'R', "Request En"... is not valid JSON` because it called `r.json()` on a plain-text
  body. `MAX_INVOICE_BYTES` is now 4 MB and `lib/http/read-response.ts` turns non-JSON responses into
  sentences — **but only for the landed-cost feature; ~180 other call sites still have the original
  bug** (§7e). The real fix for large invoices is a direct-to-storage signed upload, which does not
  exist anywhere in this app.

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

**Drafts ARE surfaced to the voice agent — deliberately, after a reversal.** They were briefly excluded
on the reasoning "no price, so hide it". That was wrong: knowing about a product and being able to
quote it are different things, and hiding a draft makes the agent say "we don't stock that" about goods
the business has bought and paid for. They now come back with no price, no availability, no stock and
`not_priced: true`, and `speakableAnswer` supplies the finished sentence. See `toToolPayload`.

The guarantee is structural only as far as OUR number goes: omitting the field means the model cannot
read out a price we hold. It cannot stop the model inventing one from world knowledge — that is what
the supplied `say` is for, with the prompt instruction as a second layer rather than the only one.

**`inactive` is still surfaced to the voice agent.** `retrieval.ts` excludes `discontinued` only.
Whether an inactive product should be quotable is a real question and a separate decision that affects
existing tenants; it was deliberately not changed while adding `draft`.

### Bulk-created products need a naming pass

Nobody hand-edits 126 names. The real Primavera invoice produced three products called just `FABRIC`
(SKUs 1341545, 1341546, 1341547) and more like them — supplier shorthand that is fine on an invoice
line and useless as a catalogue name.

**This is a usability problem, not a correctness one**, and the distinction matters because the obvious
worry is wrong. The next invoice from that supplier still matches correctly: `exact_sku` is the first
rung and those SKUs are distinct, so the name is never consulted. It only degrades for a line with no
SKU or a changed one — and there, three products named identically score identically, the gap is zero,
and `AMBIGUITY_MARGIN` refuses. The result is *unmatched*, not *wrongly matched*: the safe direction,
and the same guard that correctly refused Oak/Ash.

What it actually costs is a catalogue the owner cannot navigate, and 126 products he has to rename
before any of them can be sold. Worth a bulk-rename surface, or a better default name than the raw
description — but neither is urgent and neither fixes a wrong number.

### Product names that aren't English words get mangled by the phone

From the same call. Six lookups reached the tool; four carried transcription damage:

```
Vaja soda · Raja soda · Roger Solphine · Rosa raja · Raja sofa · Raja Sofa
```

The model passed on exactly what it heard, faithfully. "RAJA" is not a word English speech-to-text
expects, and no amount of retrieval quality fixes a name that never arrives intact.

Two things follow, and the second matters more:

- It is a **second and sharper argument for the naming pass** than the catalogue being hard to read.
  `RAJA 2,5 PL` is not only unreadable on screen, it is unsayable and unhearable on a phone.
- **Partial matching is not a nicety.** It is how the system stays useful when transcription is
  imperfect, which is always: "Rosa raja" loses a word to the line and still finds the RAJA items on
  the word that survived. Anything that depends on the whole phrase arriving correctly will fail on
  the phone regularly, and silently.

## 7b. Buying the same product twice: LATEST WINS, and why weighted average would be wrong

Settled 7 Aug 2026. `product_costs` holds one row per product, so it can express exactly one cost, and
a second shipment REPLACES the first one's figure rather than accumulating with it. That is the chosen
behaviour, not a limitation being tolerated.

**Latest wins** is right for this business. An importer prices from replacement cost — what the next one
costs is the number that decides what to charge — and every figure on the product traces to one document
he can hold. That last property is the same one that made blending three cushion lines unacceptable: a
weighted average is a number that appears on no piece of paper, and rejecting it there while adopting it
here would be inconsistent.

### Weighted average is not merely unbuilt — it would be WRONG with the data we keep

Someone will ask for it, and "we didn't build it" is the wrong answer. The right one:

Proper weighted-average cost is computed over units **ON HAND**. It answers "what did the stock I still
own cost me", which is why accountants use it. Computing it needs to know how many units remain from
each purchase — cost layers tied to receipts.

**We deliberately do not record receipt.** A supplier invoice is issued at SHIPMENT and the container is
at sea for weeks; writing stock from an invoice would have the voice agent promise a caller a sofa
that is mid-Atlantic (see §7). So the only average available to us is over **every unit ever purchased**,
including ones sold two years ago.

That is not weighted-average cost. It is "mean price historically paid" — a different and less useful
number wearing an accounting label, and the label is what makes it dangerous: it would be trusted as
though it meant the thing it is named after.

Doing it properly is an inventory-costing subsystem — cost layers, receipts, consumption — not two
columns on `product_costs`. If that is ever wanted, it starts with recording receipt separately from
invoicing, and that is the decision to make first.

### Cost-per-shipment does not remove the decision either

Dropping the partial unique index and adding `shipment_id` would preserve every shipment's figure. But
the cost card and the margin still need ONE number, so latest-or-average would still have to be chosen
on top. It is a retention change, not a third option — and retention is already handled, below.

### History is preserved, and now visible

Nothing is lost when a reorder overwrites a cost:

- `supplier_invoice_lines.allocated_freight` / `_duties` — permanent, per shipment. Shipment 1 keeps
  what it allocated to a product forever.
- `landed_cost_shipments.applied_before` — a snapshot of `product_costs` before that shipment first
  landed, so shipment 2's snapshot IS shipment 1's contribution. Captured on FIRST apply only, by
  design; a re-apply does not re-snapshot, so the chain holds as long as each shipment applies once.

Both were unread until `lib/catalog/cost-provenance.ts`. The cost card now says which invoice set the
figure and what it replaced, which was a display gap rather than a data-model one.

## 7c. DESIGN RULE — don't classify, characterise

This is a rule, not a note about the divergence flag. It has bitten this feature three times, in three
different places, and each time it looked like a different problem.

**The rule.** When the data cannot settle a question, do not have the machine guess at the answer. Name
what the data *does* show, in terms specific enough to act on, and leave the judgement to the person
holding the document. A machine guessing at something it cannot see gets ignored the moment it is wrong
twice — and then it is worse than silence, because the screen looks like it is watching something.

**The three times:**

1. **The catalog banner.** A banner that shows on every visit is furniture. Anything that always fires
   stops being read, so it has to fire on a state that is actually sometimes false.
2. **The reorder notice.** It fires on OVERLAP — "this product already has a cost from an earlier
   shipment" — which is true of every repeat order by construction. By the third shipment it is
   wallpaper, and the one time it matters it is skimmed past with the rest.
3. **The divergence flag** (this one). It would have been easy to write "probably a data-entry error"
   next to a 40% move. It cannot be known: timber going up 40% and an extraction misreading 1,386 as
   1,886 are *identical in this data*, and the invoice PDF is the only arbiter. So the flag reports the
   magnitude, and where the ratio lands on a recognisable shape it names the shape as a question.

**The general shape of the failure.** Always-true signals and confident-but-unknowable verdicts are the
same bug at two different levels. Both teach the reader that the screen's warnings do not carry
information, and once that is learned it applies to every warning on the page, including the correct
ones. The cost of a false positive is not the one alert — it is the credibility of the next hundred.

**What characterising looks like in practice.** Compare:

> ✗ "Probably a data-entry error (confidence: medium)."
> ✓ "These two figures differ by almost exactly the 1.2 exchange rate — one of them may already be
>    converted while the other is not."

The second is a question the owner answers in two seconds by looking at the paper. The first is a
machine's opinion about a document it has already read as well as it can.

**And never say which one is wrong.** The corollary, learned before the code was written: if shipment 1
carried the error, the flag fires on shipment 2's *correct* figure. A message asserting which figure is
wrong sends the owner to "fix" the right number. Every shape note is therefore phrased as a
disagreement between two figures — `divergence.test.ts` asserts that, so a future rewrite that quietly
becomes a verdict fails the suite.

**Related, and the reason to be careful about relaxing thresholds.** The divergence gate is 10% AND $5
in base currency, both required. The absolute floor is not a refinement — it is what stops every alert
coming from cheap SKUs, which are most of the lines on a real invoice. Raising sensitivity to "catch
more" is the direct route back to wallpaper.

## 7d. Uploads are capped at ~4.5 MB by the platform, not by us

**Measured 7 Aug 2026** against the production deployment, by posting bodies of increasing size and
watching where the answer stopped coming from our code:

```
4,194,304 bytes (4.00 MiB) -> 307  (reached middleware — accepted)
4,400,000 bytes (4.20 MiB) -> 307  (accepted)
4,500,000 bytes (4.29 MiB) -> 413  Request Entity Too Large / FUNCTION_PAYLOAD_TOO_LARGE
4,600,000 bytes            -> 413
```

The rejection happens at the edge, **before routing, auth, or any handler**. No code in this repository
can catch it, log it, retry it, or turn it into a sentence. Vercel has announced 100 MB bodies on Fluid
Compute; this project does not have it. Re-measure before believing otherwise — do not raise a limit
because a changelog says so.

**`MAX_INVOICE_BYTES` was 20 MB, which was a promise the platform does not keep.** A 6 MB invoice passed
`invoiceFileError` at the file picker, uploaded, and died at the edge with a message nothing here wrote.
The check said yes and the platform said no — worse than a low limit honestly stated, because the person
had already waited for the upload. Now 4 MB: the platform ceiling less multipart overhead (boundary,
part headers, filename), which is real and would otherwise fail a file sized exactly at the limit.

Two features shared the broken promise, not one — the owner-facing supplier-invoice upload, and the
**public factory hand-off** in `lib/orders/approvals.ts`, where the person hitting it is a supplier with
no support channel and a token for a URL.

**`MAX_ATTACHMENT_BYTES` (50 MB) is still unreachable and deliberately NOT lowered.** Order attachments
accept CAD, video and archives, which genuinely exceed 4.5 MB. Lowering the number would disable the
feature rather than fix it. A 12 MB `.blend` still fails — now with a sentence instead of a parse error,
but it fails. **The honest fix for both is a direct-to-storage signed upload that never passes through a
function.** There is no such path anywhere in this app today: every upload streams its bytes through a
Vercel function. That is the work, not a bigger number.

## 7e. We parse the success shape and let every other shape surface as noise

The 413 above reached the owner as:

```
Unexpected token 'R', "Request En"... is not valid JSON
```

That names none of: the file, its size, the limit, or what to do. The cause is a pattern repeated at
**187 call sites** in `app/` and `components/`:

```ts
const r = await fetch(url)
const d = await r.json()            // assumes a JSON body
if (!r.ok) throw new Error(d.error) // never reached — r.json() already threw
```

It handles exactly one shape: a response one of our own routes produced. The responses that are **not**
ours are not exotic — 413 at the edge, a 307 from middleware on an expired session, 504 on duration,
502 on a crash, 429 from a rate limiter upstream of the handler. None are reachable from inside a
handler, so none can be made to return our `{ error }` shape. The only place they can become a sentence
is in the client.

`lib/http/read-response.ts` is that place. It is applied to the **landed-cost feature only** so far.
**The other ~180 call sites still have the original bug** and will keep showing parse errors for any
non-JSON response. Sweeping them is mechanical but wide, and it is not done.

This is the same fault as the middleware 307 swallowed as an empty result, and as the retrieval timeout
that sounded like a miss: **a failure wearing the costume of a different outcome.** The rule that comes
out of all three is in §7c — but the narrower version worth stating here is that *the success path is
not the only path with a shape*.

## 7f. Bundled lines: a product with a real $0.00 cost

The B&N invoice has two `SET OF CUSHIONS` lines printed at **0.00 EUR**, because the cushions are
included in the price of the chair they belong to. The invoice is honest and the extraction is correct.

But those two became products, and a product carrying $0.00 landed cost and a **100% margin** is wrong
on screen regardless of anything else. The commission backfill does not touch them (25% of zero is
zero), and they are already wrong today, so this is logged rather than solved. Product ids
`7d7defea…` and `a1b4a036…`, YDC.

Two questions to answer when it is picked up, neither of which is about arithmetic:

1. **Should a line genuinely bundled into another product become a product at all?** It has no
   independent cost and no independent price, so it will always show a fake margin. The alternatives
   are a bundled-into relationship, or simply not creating it — and "don't create it" loses the fact
   that the cushions exist, which the voice agent may well be asked about.
2. **If it should exist, what does the card show?** Zero and unknown are different facts and the card
   cannot currently tell them apart. `cost_primary = 0` renders as `$0.00`; `cost_primary IS NULL`
   renders blank. Neither says "included in the price of something else", which is the true answer.

Note this is the same distinction the cost card already gets right elsewhere — NULL-in-NULL-out exists
precisely so "free" and "not yet entered" never look alike. This is a third state neither covers.

## 7g. Commission: why per-shipment, and what the backfill actually did

The formula gained a third term on 7 Aug 2026 — see `add_cost_commission.sql` for the arithmetic and
why commission multiplies `cost_primary` alone.

**The design mistake worth recording** is that the first plan put commission on the tenant only, with
per-shipment listed as "the natural upgrade when it varies." That was reasoned from an assumption that
there was one supplier. There were already two — PRIMAVERA and B&N — and nothing in the data said
whether they carried the same rate. They do, both 25%, but **the column exists because it could not be
known**, and that stays true for the next supplier. Checking the data changed the schema.

**Measured before running anything** (all 206 rows, YDC):

| Shipment | Products | Per-row change | Spread | Landed total |
|---|---|---|---|---|
| PRIMAVERA 866/4/2026 | 126 | 20.3390% – 20.3488% | 0.0099pp | 57,226.47 → 68,868.87 |
| B&N BN-1356 | 80 (78 computable) | 17.2751% – 17.2817% | 0.0067pp | 19,984.10 → 23,437.22 |

Uniform within each shipment because **freight is allocated by line value**, so `shipping / cost` is
constant across a shipment and the commission's proportional effect is identical on every product in
it. The two shipments differ from each other for the same reason — different freight-to-goods ratios.
The residual hundredths of a percentage point are largest-remainder freight rounding to whole cents,
not bad inputs. **Any future backfill that is NOT uniform within a shipment has something wrong with
its inputs, and that is the check to run first.**

**"What this apply did" and "what we showed you" are two different records.** They coincided until
commission arrived. 20.34% clears the relative gate on every PRIMAVERA row, but the $5 absolute floor
needs a purchase price above 18.18 — so **38 of 126 changed without being flagged**. `divergence_ack`
therefore records every affected product with a `flagged` boolean and a `shown` sentence that is null
for the unflagged ones. Claiming a row was read when it was never on screen would be a false artefact,
which is worse than a missing one — the same reasoning as the timeout that must not sound like a miss.

`applied_before` is deliberately first-write-wins and does NOT re-snapshot on a re-apply, which is why
the record above had to carry the full set: without it those 38 rows would have no before-figure
anywhere.

## 7h. DESIGN RULE — never restate code from memory; extract it and assert the edits

Companion to §7c. That rule is about not guessing at facts you cannot see; this one is about not
guessing at code you already have.

**The rule.** When a change requires restating something that already exists — a `CREATE OR REPLACE`
body, a copied config, a duplicated constant — do not retype it. **Read the original text
programmatically, apply each edit as an explicit string replacement, and assert that every replacement
actually matched.** A replacement that silently finds nothing is the failure mode, so the assertion is
the point, not decoration.

**The near-miss.** `add_cost_commission.sql` has to restate `create_product_with_cost`, because
`CREATE OR REPLACE` has no partial form. The first draft was written from memory and dropped the block
that restores `name`, `status`, `availability_status`, the four quantity columns, `tags` and
`qr_code_token` after `jsonb_populate_record`. Running it would have made **every product creation
violate NOT NULL** and lose its QR token.

**Why it would have passed review.** It read as authoritative. It had the right signature, the right
guards, plausible comments, and the two intended changes clearly marked. Nobody re-derives a function
body that looks complete — the same reason the comment claiming `bestMatch` "REPORTED" degraded
matching survived, and the same reason the `ladder()` comment still cites `pear shaped diamond ring` as
a phrase the floor fix rescued when it does not. **A restatement that drifts is more dangerous than a
fragment, because a fragment advertises that it is incomplete.**

**What the pattern looks like:**

```python
orig = Path('supabase/migrations/add_product_with_cost_rpc.sql').read_text()
fn   = orig[orig.index('CREATE OR REPLACE FUNCTION create_product_with_cost('):][:...]

before = fn
fn = fn.replace(OLD_DECLARE, NEW_DECLARE)
assert fn != before            # <- the whole point
```

Four edits, four assertions. If the source file is later reformatted, the migration generator fails
loudly instead of emitting a function with a missing block.

**The general shape.** Any time correctness depends on text being identical to text somewhere else, the
copy must be produced mechanically. That covers restated SQL functions, the SQL↔TS formula mirror in
`cost-math.ts` (defended by golden vectors instead, since a generated column cannot call TypeScript),
and any future "paste this config into both places."

## 7i. The false artefact we created, and how

On 7 Aug 2026 both YDC shipments were re-applied to add the 25% supplier commission. The costs wrote
correctly. **The audit record claimed a review that never happened**, on 166 flagged products.

**How.** `divergence_ack` entries carried one field, `shown`, holding the sentence for that product —
and its presence was read as "the owner saw this." Two things then had to be true for that to hold: the
banner had to render, and the acknowledgement had to be sent only after it did. Neither was enforced.
The re-apply button sent `acknowledgeDivergence: true` unconditionally, on the reasoning that *the
banner is visible above it*. A tab loaded before the deploy held an empty `divergences` list, so no
banner rendered, and the flag went anyway.

**Why the numbers survived.** The server recomputes divergence from the database at the moment of the
write rather than trusting the request — so the record's figures are correct and complete despite the
client being stale. That decision is the only reason this is a correctable record rather than a lost
one.

**The category error.** One field meant three things:

| Fact | Who can know it |
|---|---|
| Did this move clear both thresholds? | **Server** — derived from the numbers beside it |
| What is the wording for this row? | **Server** — regenerable at any time |
| Did a human see it and go ahead? | **Client only**, and only after a confirm step |

They are now three fields: `flagged`, `sentence`, `acknowledged`. The first two are reproducible; the
third is a claim, and it is recorded as one. **Conflating "was worth showing" with "was shown" is what
made the false artefact possible; splitting them is what makes it impossible rather than unlikely.**

**The structural fix.** The sentences and the button that acknowledges them now live in one block, so
they cannot be separated by a layout change or a stale fetch. And `acknowledged` is false for unflagged
rows unconditionally — they were never rendered, so no request can claim they were.

**The correction.** `correct_divergence_ack_2026_08_07.sql` sets `acknowledged: false` and nulls the
sentences on both records, leaving every number untouched, and writes a `correction` block into the
record saying when and why. Not left alone: a missing artefact prompts a question, a false one ends the
enquiry, and keeping it to avoid the discomfort of amending an audit trail would preserve a lie in
order to protect the principle the lie already breaks. There is no down statement — restoring `shown`
would restore the claim.

**The general rule.** Whenever a record asserts that a human did something, the assertion must be
produced by the same code path that gave them the chance to do it. If the two can drift — a banner
here, a flag there — they eventually will, and the record will be confidently wrong rather than
silent. Related: §7c (don't classify, characterise) and §7h (extract, don't restate).

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
