# TG Jewellers / TG Designs / Vancouver Gem Lab — production-readiness audit

The development master list for Tatiana's tenant (`e6f07ad7…`, `tg-jewellers`). One row per
numbered requirement in the brief, with what was found, what was done, where it lives, what tests
it, and what still blocks it. Update this file when a row changes; do not recreate the brief.

Audit date 2026-09-14. Branch `fix/tg-jewellers-2` (production is deployed FROM this branch — see
"Deploy" at the end). Pending migration: **`supabase/migrations/add_tg_production_1.sql`** — nine
parts, run one at a time. Every part is additive and the app degrades honestly until each is run
(each row below says what waits on which part).

Status key: **WORKING** (existed, verified, unchanged) · **REPAIRED** (existed, was broken/partial,
fixed) · **ADDED** (genuinely missing, built) · **BLOCKED** (needs an external credential/account) ·
**N/A**.

## How the model works (read first)

One `orders` row is the record from lead to invoice. Estimate, quote and invoice are *renderings* of
that row (`lib/orders/documents.ts`), never copies — so Estimate → Order → Invoice carries every
field by construction and there is no conversion step to lose data in. Stages live on the row
(`lib/orders/stages.ts`), history in `order_events`, money in the platform ledger
`payment_allocations` (`document_type = 'order'`), files in `order_attachments`, and the customer
in `contacts` via `contact_id`. Repairs and appraisals are orders with a `order_kind`. Memos are the
one genuinely separate thing, because they are stock in someone else's hands, not a sale.

## P0

| # | Item | Status | Found | Done | Where | Tests |
|---|---|---|---|---|---|---|
| 1 | Closed – No Sale | **REPAIRED** | Existed (`closed_no_sale`, reopenable, non-destructive). Migration was already applied. Gap: `Delete order` was reachable on any order, and closed estimates were invisible on the customer. | Delete now refused server-side past `new` or once a link/approval/payment exists (`deletable`); no-sale estimates listed on the customer profile with everything else; searchable across views. | `lib/orders/store.ts` (`deletable`, `setStageManual`), `app/api/orders/[id]/route.ts`, `lib/customer/history.ts`, `app/orders/page.tsx` | `closed-no-sale.test.ts` ("closing never destroys"), `link-contact.test.ts`, `verify-tg-production.mjs` §6 |
| 2 | Closed Order | **REPAIRED** | `completed`/`finished` were terminal but every list filtered by hand-written stage lists; "Finished" view; no summary label. | `orderStatusGroup()` = active / closed / no_sale / cancelled is the ONE predicate; list views, customer history and the order page badge ("Closed Order") read it. Reopen is an explicit confirmed action. | `lib/orders/stages.ts`, `app/orders/page.tsx`, `app/orders/[id]/page.tsx` | `orders.test.ts` ("groups the sixteen stages…") |
| 3 | Estimate → Order → Invoice carry-forward | **REPAIRED** | Carry-forward was already by design (one row). Defect: the invoice could only be raised on a completed/finished order, so deposit invoices were impossible. | `raiseInvoice` allowed at any stage but cancelled; **Raise invoice / Invoice ↗** in the action bar; totals from one function on page, panel and document. | `lib/orders/finish.ts`, `components/orders/invoice-button.tsx`, `lib/orders/payment-types.ts` | `payments.test.ts` ("the invoice does not wait for production") |
| 4 | Product info not saving | **REPAIRED** | Four causes: (a) a filled-in line with no product name was dropped client-side → `lineItems: []` → all lines wiped (fixed in db120a6, on this branch); (b) the edit drawer seeded state once and re-sent stale values on every later save (tax, exemption, lines); (c) re-saving lines recomputed balance with deposit = 0; (d) two items shared the same control ids, so labels edited the wrong line. | (b) drawer rebuilds from current props on open; (c) deposit read from the row; (d) ids per line. | `components/orders/order-edit.tsx`, `lib/orders/store.ts`, `components/orders/line-item-fields.tsx`, `lib/orders/rows.ts` | `persistence.test.ts` — full bracelet round trip (form → schema → row → object → form) + source guards for all four layers |
| 5 | Public customer document link | **REPAIRED** | The `/e/[token]` public page existed and worked (no login). What she was sending was the **address bar of her own tab** (`/orders/[id]/document/estimate`), which is behind login → "asked to log in". Video: admitted on this branch. **Certificate PDFs were filtered out** of the customer copy. Signed URLs died after 30 min. Email sender/title said "TG jewellers" on a T.G. Designs document. | **Copy customer link** on the document toolbar mints a share link without emailing; PDFs listed under "Certificates & documents"; every file on the customer copy goes through `/e/[token]/file/[id]` which re-signs at click time and checks tenant+order+visibility; sender name and reply-to follow the letterhead; tab title too. | `components/orders/send-document.tsx`, `app/api/orders/[id]/shares/route.ts`, `lib/orders/shares.ts`, `app/e/[token]/file/[attachmentId]/route.ts`, `lib/orders/attachments.ts`, `components/orders/document-body.tsx` | `public-document.test.ts`, `shared-document.test.ts`, `no-platform-branding.test.ts`, `verify-tg-production.mjs` §1–4 (logged-out fetch, PDF download, boundary, revoke) |
| 6 | CAD / custom design board | **REPAIRED** | Board + drag existed (this branch). Moves were next-column-only; approval columns locked; no touch. | Any live stage ↔ any live stage, both directions; endings from live only; Reopen explicit. ⋯ move menu on every card for phones; filter box. Every move → `order_events` with from/to/who/reason. | `lib/orders/stages.ts`, `components/orders/board-columns.tsx`, `components/orders/stage-control.tsx` | `orders.test.ts`, `board-drag.test.ts` |
| 7 | Status model | **REPAIRED** | 15 stages, well-modelled; no "In Process"; history rows lacked a reason and printed a uuid as the actor. | `in_process` added (migration part 1); stage route takes `note`; timeline prints "from → to — reason · name"; names resolved from auth. Estimate/Quote/Invoice are documents (events `document_shared`), Memo is its own module. | `lib/orders/stages.ts`, `lib/orders/actors.ts`, `app/orders/[id]/page.tsx` | `orders.test.ts`, `board-drag.test.ts` |

## P1 — core operations

| # | Item | Status | Found | Done | Where | Tests |
|---|---|---|---|---|---|---|
| 8 | Customer + company | **REPAIRED** | Contacts had company/first/last (db120a6). 21 of 36 orders had no `contact_id` — typed walk-ins, invisible on the person. | Orders link themselves: match by email then phone (never name), else create the contact from what was typed; migration part 9 links existing orders with an unambiguous email match. `?contact=` prefills a new order. | `lib/orders/link-contact.ts`, `lib/orders/store.ts`, `app/orders/new/page.tsx` | `link-contact.test.ts` |
| 9 | Jewellery types | **REPAIRED** | Ring, band, earrings, pendant, necklace, tennis ×2, bracelet. | + Chain, Watch, Loose stone, Other, each with its own field set; migration part 8b appends them to her list. | `lib/orders/product-types.ts` | `product-types.test.ts` |
| 10 | Type-specific specs | **WORKING** | Field sets per type, printed with the same labels on the document (`specRows`). | Verified; loose stone / chain / watch sets added. | `lib/orders/product-types.ts`, `lib/orders/documents.ts` | `product-types.test.ts`, `document-body.render.test.tsx` |
| 11 | B2B / TG Designs | **WORKING + REPAIRED** | Two letterheads with separate identities, per-order choice — working. Emails and tab titles still said "TG jewellers" on a Designs document. | `documentSender()` resolves the letterhead's name + reply-to for the email and the title. | `lib/orders/shares.ts` | `public-document.test.ts`, smoke §1 |
| 12 | Vendor / factory quotation | **ADDED** | Factory approval link existed (spec + attachments + yes/no + comment + date). No way to ask for a *cost*. | `request_kind = 'quote'` on the same request (part 7): "Ask for a quotation" on the send form, the factory page asks for a cost, `quoted_cost_cents` shown internally on the order. | `lib/orders/approvals.ts`, `components/orders/approval-actions.tsx`, `app/approval/[token]/page.tsx` | (covered by existing approval tests; DB column pending) |
| 13 | Payments | **ADDED** | One typed `deposit_cents`; no history, no method, no reference. Platform ledger `payment_allocations` existed and already admitted `document_type='order'`. | Payments panel: deposit / payment / refund, method (card, cheque, cash, wire, e-transfer, other), reference, date, note; Subtotal / Tax / Total / Paid / Balance due everywhere from `orderTotals`; `deposit_cents` kept written as the ledger sum. Part 2 adds `wire`/`etransfer`/`paid_on`; part 3 backfills typed deposits. No card data anywhere. | `lib/orders/payments.ts`, `lib/orders/payment-types.ts`, `components/orders/payments-panel.tsx`, `app/api/orders/[id]/payments/*` | `payments.test.ts` |
| 14 | Canadian taxes | **WORKING** | Snapshot per order, place-of-supply, PST exemption note; live fallback for old orders. | Unchanged. `resolveOrderTax()` is now the one resolver the page and document share. | `lib/tax/canada.ts`, `lib/orders/document-data.ts` | `canada.test.ts`, `order-tax.test.ts`, `payments.test.ts` |

## P1 — supply side and workflows

| # | Item | Status | Found | Done | Where | Tests |
|---|---|---|---|---|---|---|
| 15 | Purchases | **ADDED** | Suppliers + landed-cost supplier invoices existed; nothing linking a stone/mounting purchase to a job. | `order_purchases` (part 5): kind, supplier, cost (internal), reference, statuses draft → waiting → in production → shipped → received → QC passed, dates; panel on the order; events on the timeline. | `lib/orders/purchases.ts`, `components/orders/purchases-panel.tsx`, `app/api/orders/[id]/purchases/*` | (DB pending; source-level only) |
| 16 | Memo | **ADDED** | Nothing. Inventory = `catalog_products` (3 locations) + `catalog_movements`. | `memos` (part 4): out (ours, to a customer/dealer) and in (a supplier's, to us); statuses Sent/Received, Follow up, Pending decision, Sold, Returned; **ownership is a column**; stock follows every transition through the catalog ledger (`memo_out`, `memo_return`, `memo_in`, `memo_return_supplier`, `sell`); `on_memo_quantity` + `ownership` on products; history table; on the customer profile. | `lib/memos/*`, `app/orders/memos/*`, `components/memos/*`, `app/api/memos/*` | `memos.test.ts` |
| 17 | Consignment | **ADDED** | — | Same module, `kind = 'consignment'`, ownership `consignment`, sale records owed amount, "Mark supplier paid". | as above | as above |
| 18 | Repair | **ADDED** | — | `order_kind = 'repair'` (part 6): item brought in + repair requested; same stages, payments, documents, history. | `lib/orders/kinds.ts`, `components/orders/kind-fields.tsx` | `kinds.test.ts` |
| 19 | Appraisal | **ADDED** | — | `order_kind = 'appraisal'`: purpose (insurance, estate/probate, value confirmation, purchase verification, sale consideration, other), appraiser; the PDF is an attachment. | as above | as above |
| 20 | Inventory / archive | **WORKING + ADDED** | "Add to catalog" at the end existed (qty 0). Movements ledger existed. | Memo movements added to the same ledger; nothing disappears — closed orders stay, memos keep history. | `lib/orders/finish.ts`, `lib/memos/store.ts` | `memos.test.ts` |
| 21 | Customer history | **ADDED** | Contact page showed conversations only. | Orders & estimates (incl. no-sale, closed, cancelled; matched by link OR the email/phone typed on the order), payments, memos, appointments; "New order" from the profile. | `lib/customer/history.ts`, `app/contacts/[id]/page.tsx` | `link-contact.test.ts` |

## P2 — integrations

| # | Item | Status | Found | Notes |
|---|---|---|---|---|
| 22 | Acuity | **BLOCKED** | No Acuity code anywhere. Own scheduling + Google Calendar exist. Her `catalog_sources` row points at `tgjewellers.com/appointment` (Acuity) and found no products. | Acuity webhooks send only ids; the details fetch needs her Acuity API user + key. Not built without credentials. Architecture to use: `/api/webhooks/acuity` → `resolveContactForOrder`-style match on email/phone → `appointments` row. |
| 23 | QuickBooks | **BLOCKED / PARTIAL** | Connect-only (OAuth, sandbox) by earlier decision; **no connection row for TG**; no sync. | Nothing to verify until she connects. Sync remains deliberately unbuilt (see memory: connect-only). |
| 24 | Three mailboxes | **PARTIAL** | Two connected: `sales@tgjewellers.com` → Alex, `vancouvergemlab@gmail.com` → Avi. No third (TG Designs / watches). Per-mailbox → per-agent routing works. | She connects the third mailbox to a third AI employee in the app; nothing in code blocks it. |
| 25 | Separate assistants | **REPAIRED** | Two agents, not three. **Knowledge leak**: a website scan wrote tenant-wide rows and deleted the other agent's scan — Avi's gem-lab scan had removed Alex's and was being read by Alex. | Scans and business details now agent-scoped and replaced per agent; TG's three gem-lab rows re-scoped to Avi (done live); migration part 8a does the same for any multi-agent tenant. **Alex's website knowledge is gone and must be re-scanned** (Alex → Scan website). Avi has no business name/phone set. | `app/api/agents/[id]/scan-website`, `…/business-details`; `isolation.test.ts` |
| 26 | Email quality | **REPAIRED** | Empty system prompts + six bullet rules + no thread memory → robotic. | Identity from the agent row, style rules (what not to write), thread history passed as prior turns. | `lib/email/reply.ts`, `app/api/mailbox/poll/route.ts`; `isolation.test.ts` |
| 27 | Appraisal Q&A | **ADDED** | Searched DB, seeds, prompts, migrations, archives: no Q&A existed anywhere (3 website rows only). | 88 Q&A pairs in 12 topics + one "Appraisal pricing" entry ($80 from; $120–250 complicated) seeded on **Avi only**, editable in the app; prices in the one entry. `scripts/seed-appraisal-knowledge.mjs` (run 2026-09-14). |
| 28 | Phone AI | **BLOCKED** | Alex: +1 689 399 4162 (US) voice+SMS; Avi: +1 570 365 5037 (US). Routing by number → agent works. **No Canadian number** on the Twilio account; TG's tenant timezone is `America/New_York` (should be `America/Vancouver`). | A Canadian number needs a Twilio CA regulatory bundle and incurs charges — not purchased. Timezone is a one-field settings change (recommended; not changed here). |
| 29 | WhatsApp / history | **PARTIAL** | Email, SMS, voice conversations unify on the contact. WhatsApp requires Meta channel connection (none for TG). | Not claimed. |

## P2 — UX

| # | Item | Status | Notes |
|---|---|---|---|
| 30 | Board | **REPAIRED** | Drag persists server-side (same route as buttons); refresh shows the same state; colour per stage; filter box; ⋯ move menu on phones; follow-up dates on memos. |
| 31 | Status history | **REPAIRED** | Every stage move, payment, document send, purchase and approval on the order timeline with time, from → to, actor name, reason. |
| 32 | Mobile | **WORKING** | Responsive web (v2 kit rows on phones). No PWA, no native app. Board drag does not fire on touch (HTML5 API) → the ⋯ menu is the phone path. |
| 33 | Website import | **BLOCKED** | `catalog_sources` row for tgjewellers.com is paused with `no_products_found` (URL was the Acuity appointment page; the site is a custom Next.js build with no product feed). Needs an export from her site vendor / Odoo. Importer architecture (`lib/ingestion`) is ready for a feed. |

## Hardening pass (2026-09-14, later the same day)

### Migration state, verified part by part against production

No DDL path exists from the development machine (no connection string in Vercel env, no `psql`, no
Supabase CLI) — every part below is applied by hand in the SQL editor, one part per run, and
re-verified afterwards with `scripts/verify-tg-production.mjs` (which reports each part as applied
true/false). Probed 2026-09-14 before anything was run:

| Part | Needed? | Evidence | Backfill | Constraints vs. rows | RLS / index |
|---|---|---|---|---|---|
| 1 `in_process` | yes | stage CHECK refuses it (23514) | none | every existing stage is in the new list | n/a |
| 2 ledger `wire`/`etransfer`/`paid_on` | yes | `paid_on` absent (42703); methods in use: null, zelle | none | `CREATE OR REPLACE` same signature; `lib/core/payments.ts` is the only RPC caller | n/a |
| 3 typed deposits → ledger | yes | 6 orders with `deposit_cents > 0` (5 TG, 1 demo tenant), 0 order ledger rows | inserts 6 rows, `idempotency_key legacy-deposit:<id>`, NOT EXISTS guard | n/a | n/a |
| 4 memos + catalog ownership | yes | tables 404; columns absent; movement types in use: receive, sell (both in the new CHECK) | none | new CHECK is a superset | RLS `get_tenant_id()` policies (36 prior migrations use it); indexes on tenant/status/contact/product |
| 5 `order_purchases` | yes | table 404 | none | n/a | RLS + indexes |
| 6 `order_kind` / `kind_details` | yes | columns absent | default `'custom'` for every row | n/a | n/a |
| 7 `request_kind` / `quoted_cost_cents` | yes | columns absent | default `'approval'` | n/a | n/a |
| 8a knowledge re-scope | **already applied by hand** (0 rows on rerun) | TG's 3 website rows are scoped to Avi | — | pinned to TG's tenant: the demo tenant's two agents share one website and must stay shared | n/a |
| 8b four piece types | yes | TG's list lacks Chain/Watch/Loose stone/Other; TG is the only tenant with the list | 4 option rows, appended | NOT EXISTS by label | n/a |
| 9 walk-in orders → contacts | **already applied by script** (0 rows on rerun) | see below | — | never by name; own-address guard (`tg_is_business_address`) | n/a |

Dependencies: none between parts. Idempotent: every statement is `IF NOT EXISTS` / `DROP … IF EXISTS` / guarded UPDATE. Destructive: nothing.

### Database drift — what was changed outside a migration, and how the repository describes it

| Change | Done live | Reproducible from the repo by |
|---|---|---|
| 3 gem-lab website knowledge rows scoped to Avi | REST, 2026-09-14 | migration part 8a (same rows, 0 on rerun) |
| 13 appraisal Q&A entries (88 pairs + pricing) on Avi | `scripts/seed-appraisal-knowledge.mjs <avi-id>` | the same script: skips any title that already exists, so a rerun writes nothing and **never overwrites Tatiana's edits**; `--replace` exists only for a deliberate reseed and is not part of the environment |
| 4 walk-in orders linked to contacts | `scripts/audit-order-contacts.mjs --apply` | migration part 9 (same rule, 0 on rerun) |
| tenant + 2 agents timezone → `America/Vancouver` | REST | data, not schema; asserted by the smoke script (5d) |

Order of a rebuilt environment: run every migration → run `seed-appraisal-knowledge.mjs` for the appraisal agent → set the timezone in Settings. IDs are stable throughout (nothing is deleted and recreated).

### Historical orders → contacts (item 5)

`scripts/audit-order-contacts.mjs` (dry run by default). Result on TG, 21 unlinked orders:

- **SAFE AUTO-LINK 4** — linked (`ORD-3VZBACQN` Britton by email, `ORD-FJ8T0BN6` M&P Yacht Centre by email, `ORD-MECB5MPG` Artin by phone, `ORD-YG1Y4QNN` Jewels by Maxime by email). Each got a `contact_linked` timeline row.
- **AMBIGUOUS 9** — all of them match the business's own address (`tatiana@tg-designs.com` ×7, the platform admin's ×2) typed as a placeholder on other people's orders (Andrea, Mateen, "STOCK"). An exact email match is not a customer match there; left for Tatiana to assign.
- **NO MATCH 8** — no contact shares the email or phone (Suzanna Shan Su, Alex Cook, Tim King, LL Private Jewellers, Jewels by Maxime at a second address, Dylan Engright, Garo, one blank). Left alone; the customer page still finds them by the email/phone typed on the order.

### Line-item ids (item 6)

Nothing references `order_line_items.id`: no foreign key in the schema, and none of the new features (purchases → order; memos → product/order; approval attachments → attachment ids; payments → order; invoice renders lines live) keys on a line. The only line-level column is `image_attachment_id`, which is never written (§9 of `lib/orders/OUTSTANDING.md`). **Technical debt, not a blocker**: `updateOrder` still replaces lines on every save, so any future per-line reference needs an in-place upsert first.

### Partial failure without transactions (item 7)

| Operation | If step 2 fails | Retry | Duplicate events? | Contradiction? | Fix made |
|---|---|---|---|---|---|
| payment: ledger insert → cache `deposit_cents` | ledger right, cache stale | same idempotency key → **now rewrites the cache** | no (key) | no: page, history and **the document loader read the ledger** | `writeRunningTotal`, ledger-derived deposit in `loadOrderDocument` |
| memo transition: status → stock | status moved, stock not | status write is **conditional on the status read** → a retry/double-tap moves no stock | no | no: **every stock failure reverts the status** | optimistic lock + `revert()` |
| memo create (in): product → memo | product without memo | — | no | **product removed** if the memo insert fails | compensation |
| memo create (out): memo → stock | memo without stock move | — | no | memo deleted if stock cannot leave (existing) | — |
| order update: lines → order row | lines new, subtotal old | — | no | **order-row failure restores previous lines**; degraded notice after the row write | `restoreLines()` |
| order create: order → lines → contact link | order without lines (already thrown, loudly) | — | no | contact link failure never fails the order | — |
| stage move: update → event | stage moved, no history row | idempotent | no | **event failure is logged** with order id and type | `addEvent` logs |
| purchases | touch no stock by design | — | — | — | — |

### Items 8–12

- **Timezone**: resolution order is primary agent → tenant → default (`lib/timezone.ts`). All three rows set to `America/Vancouver`; no timestamp touched; slots endpoint verified live; asserted in the smoke script.
- **Isolation gate**: `verify-tg-production.mjs` §5c reads knowledge with the exact reader filter for Alex and Avi and asserts Avi sees its appraisal rows, Alex sees none of Avi's, no website row is tenant-wide, and a re-scan by one agent leaves the other's rows. Unit gate: `lib/knowledge/isolation.test.ts`.
- **Token security**: §5b adds cross-tenant attachment refusal, non-uuid ids, signed-URL lifetime ≤ 300 s bound to the stored path, 43-char base64url tokens; cross-order, internal-file, garbage-token and revocation were already covered.
- **Link UX**: "Copy customer link" is the filled primary control on the internal document page; "Preview as customer" opens the customer copy; the page says the address bar is not the link; a guard test asserts no outbound email carries an `/orders/` URL.
- **Integrations honesty**: QuickBooks card says "Not connected … connect-only: invoices and payments are not synced". No UI claims Acuity, WhatsApp, a Canadian number or a product feed.

### Business-path smoke

`node scripts/smoke-business-path.mjs <url>` — signs in as the probe account (its own demo tenant), runs the whole path through the HTTP API, and removes everything it made. Steps behind an unapplied migration part report `PENDING(part N)`.

## Migrations made

`supabase/migrations/add_tg_production_1.sql` — parts: (1) `in_process` stage; (2) ledger `wire`/`etransfer` + `paid_on` + RPC; (3) typed deposits → ledger rows; (4) memos + catalog ownership/on-memo; (5) `order_purchases`; (6) `order_kind`/`kind_details`; (7) `request_kind`/`quoted_cost_cents`; (8) knowledge re-scoping + four piece types on her list; (9) link walk-in orders to contacts by unique email. All idempotent, all additive, none destructive.

Already applied before this work (verified against the database): `add_tg_jewellers_2.sql` (all 5 parts), `add_order_closed_no_sale_stage` (folded), contacts company columns.

## Tests added

`lib/orders/persistence.test.ts`, `payments.test.ts`, `public-document.test.ts`, `kinds.test.ts`, `link-contact.test.ts`, `lib/memos/memos.test.ts`, `lib/knowledge/isolation.test.ts`, plus additions to `orders.test.ts`, `board-drag.test.ts`, `closed-no-sale.test.ts`, `product-types.test.ts`, `shared-document.test.ts`, `nameless-line.test.ts`. Suite: 2114 passing. Deployed smoke: `node scripts/verify-tg-production.mjs <base-url>` (33 checks, throwaway rows, cleans up) — ran green against the local build on the production database.

## Architectural risks found

- **`updateOrder` replaces line items (delete + insert) on every save.** Line ids change each time; anything that will ever reference a line by id (a purchase for a specific stone, an approval per line) cannot. Not changed — the snapshot-rollback protects data — but a future in-place upsert is the right fix.
- **No transaction across PostgREST.** Order + lines + ledger are separate writes; the code compensates (rollback of lines, idempotency keys) but a mid-sequence failure can still leave an order without its items once. An RPC would close it.
- **Stage is one field; two approvals can be outstanding.** Known, accepted; the request table is the truth.
- ~~Production is deployed from the feature branch~~ **Resolved 2026-09-14**: `main` was fast-forwarded to the branch (no divergent commits on `main`), pushed, and `app.scalix26.com` is now aliased to the `git-main` deployment.
- Tenant timezone `America/New_York` on a Vancouver business affects appointment slots and any date-bounded logic.

## Remaining production concerns

1. Run `add_tg_production_1.sql` (all nine parts, in order) — until then: no In Process, payments store `transfer`/today, no memos, no purchases, no repair/appraisal kinds, no quotations.
2. Re-scan Alex's website (tgjewellers.com) in the app; set Avi's business name, phone and hours; connect the third mailbox/agent for TG Designs if wanted.
3. Set the tenant timezone to `America/Vancouver`.
4. Canadian phone number: decision + Twilio regulatory bundle.
5. Acuity API credentials, QuickBooks connection, product feed — each unblocks a row above.
6. Deploy: promote this branch (or merge to main and deploy), then run `scripts/verify-tg-production.mjs https://app.scalix26.com`.
