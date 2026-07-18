# Scalix Core Platform — Architecture (Phase 1 artifact)

Status: **Approved** (assessment + decisions). Branch: `scalix-core-platform-foundation`.
This document is the governing contract for Phases 2–7. It is intentionally boundary-focused:
it defines what is Core (shared, controlled) vs. Vertical (installed later via configuration).

## 0. Product principle

```
Customer conversation → Contact → Lead / Appointment / Estimate → Order / Work process → Invoice → Payment → Follow-up
```

Scalix26 stays ONE shared multi-tenant platform. Verticals (Jewelry, Furniture, Gym, Dental, Home
Services) are installed later as **packages** that CONFIGURE the Core (schemas, workflows, terminology,
documents, AI instructions) — they must never fork or duplicate Core domain logic.

## 1. Current state (assessment summary)

Strong, vertical-agnostic foundations already exist and are REUSED, not replaced:
- **Module registry & gating** — `lib/modules.ts` (per-tenant `enabled_modules[]` + global `module_flags`).
- **Tenancy & workspace** — `tenants` (atomic unit), `lib/workspace.ts` (`requireActiveBusinessContext`, owner/WL-operator).
- **Comms** — `channels/contacts/conversations/messages` + `runAIPipeline` across SMS/WhatsApp/Voice/Email/Meta.
- **Scheduling** — `appointments` + `appointment_slots` + Google/Outlook (`connected_calendars`).
- **Orders** — `orders/order_line_items/order_events` + dual approval loops (reference for a "document").
- **Payments** — Stripe Connect links (`payments`, `payment_requests`).
- **Catalog** — `catalog_products` + `catalog_movements`.
- **AI** — `lib/brain/context` provider registry + tenant-owned `knowledge_base`.
- **Infra** — `processed_webhook_events` idempotency, `lib/cron/auth.ts`, `lib/ratelimit.ts`.

Largely ABSENT (built in this effort): companies, unified activities/timeline, archive, dedupe/merge,
generic files, cross-channel identity, product variants, product **components**, field/attribute
definitions, estimates/quotes/invoices + conversions, a real payments allocation ledger,
reserved/available inventory with atomic movements, workflow engine, terminology & numbering config.

Known debt (documented, hardened-first-not-rewritten): tenant isolation is hybrid (DB RLS on original
schema.sql tables; ~48% of routes app-level `createAdminClient()` + manual scope); tenant-user RBAC and a
unified tenant audit log are absent; the assistant permission gate is a stub; catalog has zero tests.

## 2. Approved decisions

1. **Furniture = first consumer of the generic Product Schema.** Do NOT merge `catalog-parts` (hard-coded
   `fabric`/`measurements` columns) as-is. Re-express via Core: products + **variants** + **components** +
   **attribute definitions/values** + media + inventory. Furniture is seeded as one Product Schema; a
   Jewelry tenant uses the same engine with different definitions and never receives furniture attributes.
   Adapt useful UI/logic from the branch; do not preserve the wrong data model.
2. **`lib/opportunity/*` is dead/unwired code — intentionally DEFERRED.** Build a production-grade tenant
   CRM from actual requirements first; reassess reuse of `lib/opportunity/*` afterward.
3. **Process:** implement Phases 2→7 in order, autonomously. Per phase: scope → additive migrations →
   tests → typecheck → unit/integration tests → lint changed files → production build → focused commit →
   phase report. Continue automatically unless a STOP condition (below) occurs.

STOP-and-report conditions: a destructive migration is required · production data may be lost · a major
conflict with this architecture · a provider/production secret is required · a product decision materially
changes scope. Normal implementation details are NOT blockers.

## 3. Core vs Vertical boundary (strict)

**Core (strongly controlled in code):** auth · tenant isolation · contacts & companies · customer identity
· activities/timeline · communications provider execution · CRM primitives · scheduling · products &
variants · **product components** · product schemas & attribute definitions · estimates/quotes/orders/
invoices · payments & ledger · inventory ledger & reservations · files & security · workflows ·
configuration foundations · audit & permissions · invoice/tax/currency math · AI action execution.

**Deferred vertical behavior (installed later, NEVER in Core domain logic):** jewelry stones/carats ·
furniture-specific field names · memo/consignment · furniture/jewelry production stages · gym memberships
· dental treatment plans · vertical dashboards/navigation/AI instructions · full Vertical Studio.

Furniture definitions may be SEEDED as the first Product Schema consumer, but must not enter shared logic.

## 4. Data-model strategy

**First-class typed tables** for important shared entities (NOT EAV, NOT JSON for critical data):
`contacts, companies, products (catalog_products), product_variants, product_components, estimates,
quotes, orders, invoices, payments, payment_allocations, inventory_movements (catalog_movements+),
inventory_reservations, inventory_locations, appointments, conversations, messages, activities, files`.

**Configurable (extension data only):** `field_definitions, field_options, field_values`,
`product_schema_definitions, product_attribute_definitions, product_attribute_values`,
`workflow_definitions, workflow_stages, workflow_instances, workflow_stage_history`,
`terminology_overrides, numbering_rules`, `channel_identities`.

Rule: **critical financial, inventory, identity, and document-lifecycle data lives in typed columns**, not
in generic JSON/EAV. EAV is only for vertical/tenant-specific attributes.

### Variants vs Components (must be modeled separately)
- **Variant** = a sellable version of a product (size / material / finish / configuration). Has its own
  SKU, price override, media, inventory tracking. Table: `product_variants`.
- **Component** = a physical piece/part of a product or variant (left sofa section, ottoman, table base,
  tabletop). Table: `product_components`. Generic enough for any industry (kits, assemblies, sets).
- Multi-piece furniture ⇒ **components**, not variants. The `catalog-parts` "parts + QR" behavior maps to
  `product_components` + the reusable public page.

## 5. Non-negotiable engineering rules

- **Tenant isolation:** every new Core table has `tenant_id NOT NULL`, FKs where possible, **real RLS**
  `USING (tenant_id = get_tenant_id())`, a tenant-scoped data-access helper, and isolation tests. Harden
  NEW surfaces first; document legacy isolation debt; no risky one-phase rewrite of legacy routes.
- **Money:** integer minor units only; currency stored explicitly; server-side is source of truth; never
  floating point for totals.
- **Inventory:** mutations are atomic (single DB function/transaction); the ledger and derived state never
  drift; reserved/available are first-class.
- **Conversions (Estimate→Quote→Order→Invoice):** idempotent (idempotency key; repeat ≠ duplicate),
  auditable; preserve contact, company, currency, taxes, line items, product/variant links, custom
  line-item attributes, notes, files, discounts, totals, and a source-document link. Documents stay
  INDEPENDENT after conversion — editing an Estimate never rewrites an already-created Order/Invoice.
- **Migrations:** additive & non-destructive; no existing table replaced; DDL applied manually in Supabase
  (verified via REST + `scripts/verify-core-*.mjs`).
- **Conventions:** snake_case tables; thin API routes over typed domain services; explicit permission
  checks; DB constraints; immutable history for financial/inventory events; reuse existing patterns
  (`lib/orders/attachments.ts` signed-URL model, `lib/orders/order-number.ts` numbering, the deleted
  commerce receive-RPC as the atomic-inventory template).

## 6. Phase plan

- **Phase 1** — this artifact. No code changes to product surface.
- **Phase 2 — Shared customer & relationship layer:** `companies`, `contact_companies`, contact extensions
  (`updated_at`, `archived_at`, `owner_user_id`, normalized dedupe keys), `activities` (unified timeline),
  `files` (polymorphic), `channel_identities`, dedupe/merge foundation. Data-access helpers + isolation,
  archive, dedupe, merge tests.
- **Phase 3 — Generic Catalog & Product Schema:** `product_variants`, `product_components`,
  `field_definitions`/`product_attribute_definitions`/`_values`, `product_media`; seed the **Furniture**
  schema (fabric select; width/height/depth decimal) + components + public product/component page as the
  first consumer. Attribute/variant/tenant-isolation tests.
- **Phase 4 — Sales lifecycle:** `estimates`, `quotes`, `invoices` (+ `*_line_items`), conversion engine
  (idempotent), status history, `numbering_rules`, PDF/document-template foundation. Conversion idempotency
  + line-item-preservation tests.
- **Phase 5 — Payments & inventory integrity:** `payment_allocations` (deposits/partials/refunds/balance),
  `inventory_locations`, `inventory_reservations`, atomic movement RPC (reserve/release/receive/allocate/
  return). Financial + ledger + reservation tests.
- **Phase 6 — Workflow foundation:** `workflow_definitions`/`stages`/`instances`/`stage_history` +
  server transition API; fold `orders.stage` behind it. Transition tests.
- **Phase 7 — Configuration foundation:** custom-field & dropdown admin, `terminology_overrides`,
  numbering formats, module config, Core admin controls (only what's needed to manage the Core safely).

Vertical Packages / Vertical Studio are NOT in scope for this effort.

## 7. Deferred / dead code (documented)

- `lib/opportunity/*` — well-designed decision engine, **unwired dead code** (no tables, zero prod imports).
  Deferred per Decision 2; revisit after Phase 2/CRM.
- `catalog-parts` branch — furniture columns/parts; NOT merged; re-expressed in Phase 3.
- Estimates/Quotes/Invoices module keys in `lib/modules.ts` — ghost scaffolds until Phase 4.
