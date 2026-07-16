import { createClient } from '@/lib/supabase/server'
import { requireCommerceAccess } from './guard'
import { addCommerceEvent } from './events'
import { generateDraftNumber } from './number'

export interface DraftItemInput {
  lineKind?: 'product' | 'variant' | 'bundle' | 'component' | 'service' | 'custom' | 'note'
  productId?: string | null
  variantId?: string | null
  bundleId?: string | null
  quantity?: number
  unitPriceCents?: number
  discountCents?: number
  customerNotes?: string | null
  internalNotes?: string | null
  spaceId?: string | null
}

// Pure: draft money math (all cents). Unit-tested. Line subtotal = qty*unit − line discount (never < 0);
// total = subtotal − order discount + tax + delivery + additional.
export function computeDraftTotals(
  items: Array<{ quantity: number; unitPriceCents: number; discountCents: number }>,
  charges: { discountCents: number; taxCents: number; deliveryCents: number; additionalCents: number },
): { subtotalCents: number; totalCents: number } {
  const subtotal = items.reduce((s, i) => s + Math.max(0, Math.round(i.quantity * i.unitPriceCents) - (i.discountCents || 0)), 0)
  const total = Math.max(0, subtotal - (charges.discountCents || 0)) + (charges.taxCents || 0) + (charges.deliveryCents || 0) + (charges.additionalCents || 0)
  return { subtotalCents: subtotal, totalCents: total }
}

export async function createDraft(input: { name?: string; projectId?: string | null; customerName?: string | null; customerEmail?: string | null }) {
  const c = await requireCommerceAccess(); if (!c) return { ok: false as const, error: 'unauthorized' }
  const sb = await createClient()
  const { data, error } = await sb.from('commerce_drafts').insert({
    tenant_id: c.tenantId, draft_number: generateDraftNumber(), name: input.name ?? null, project_id: input.projectId ?? null,
    customer_name: input.customerName ?? null, customer_email: input.customerEmail ?? null, created_by: c.actor,
  }).select('id, draft_number, version').single()
  if (error) return { ok: false as const, error: error.message }
  await addCommerceEvent(c.tenantId, 'draft', data.id as string, 'created', { draftNumber: data.draft_number }, c.actor)
  return { ok: true as const, draft: data }
}

export async function getDraft(id: string) {
  const c = await requireCommerceAccess(); if (!c) return null
  const sb = await createClient()
  const [{ data: draft }, { data: items }] = await Promise.all([
    sb.from('commerce_drafts').select('*').eq('tenant_id', c.tenantId).eq('id', id).maybeSingle(),
    sb.from('commerce_draft_items').select('*').eq('tenant_id', c.tenantId).eq('draft_id', id).order('display_order'),
  ])
  if (!draft) return null
  return { draft, items: items ?? [] }
}

// Version-checked autosave (§18 optimistic concurrency). Bumps version on success; returns { conflict:true }
// when another editor already moved the draft forward (the client should reload).
export async function updateDraftMeta(id: string, expectedVersion: number, patch: Record<string, unknown>): Promise<{ ok: boolean; version?: number; conflict?: boolean; error?: string }> {
  const c = await requireCommerceAccess(); if (!c) return { ok: false, error: 'unauthorized' }
  const sb = await createClient()
  const { data, error } = await sb.from('commerce_drafts')
    .update({ ...patch, version: expectedVersion + 1, autosaved_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('tenant_id', c.tenantId).eq('id', id).eq('version', expectedVersion)
    .select('version')
  if (error) return { ok: false, error: error.message }
  if (!data || data.length === 0) return { ok: false, conflict: true }
  return { ok: true, version: data[0].version as number }
}

async function recomputeTotals(tenantId: string, draftId: string) {
  const sb = await createClient()
  const [{ data: items }, { data: draft }] = await Promise.all([
    sb.from('commerce_draft_items').select('quantity, unit_price_cents, discount_cents').eq('tenant_id', tenantId).eq('draft_id', draftId),
    sb.from('commerce_drafts').select('discount_cents, tax_cents, delivery_cents, additional_cents').eq('tenant_id', tenantId).eq('id', draftId).maybeSingle(),
  ])
  const totals = computeDraftTotals(
    (items ?? []).map((i) => ({ quantity: Number(i.quantity), unitPriceCents: Number(i.unit_price_cents), discountCents: Number(i.discount_cents) })),
    { discountCents: Number(draft?.discount_cents ?? 0), taxCents: Number(draft?.tax_cents ?? 0), deliveryCents: Number(draft?.delivery_cents ?? 0), additionalCents: Number(draft?.additional_cents ?? 0) },
  )
  await sb.from('commerce_drafts').update({ subtotal_cents: totals.subtotalCents, total_cents: totals.totalCents, updated_at: new Date().toISOString() }).eq('tenant_id', tenantId).eq('id', draftId)
}

// Add an item. Freezes a commercial snapshot from the referenced product/variant so later catalog edits
// never rewrite this draft (§4). Adding an item NEVER touches inventory (§5).
export async function addDraftItem(draftId: string, input: DraftItemInput) {
  const c = await requireCommerceAccess(); if (!c) return { ok: false as const, error: 'unauthorized' }
  const sb = await createClient()
  let snap: Record<string, unknown> = {}
  if (input.productId) {
    const { data: p } = await sb.from('commerce_products').select('name, sku, default_price, cost, cover_image').eq('tenant_id', c.tenantId).eq('id', input.productId).maybeSingle()
    if (p) snap = { description_snapshot: p.name, sku_snapshot: p.sku, price_cents_snapshot: p.default_price != null ? Math.round(Number(p.default_price) * 100) : null, cost_cents_snapshot: p.cost != null ? Math.round(Number(p.cost) * 100) : null, image_snapshot: p.cover_image }
  }
  const unit = input.unitPriceCents ?? (snap.price_cents_snapshot as number) ?? 0
  const { data, error } = await sb.from('commerce_draft_items').insert({
    tenant_id: c.tenantId, draft_id: draftId, line_kind: input.lineKind ?? 'product',
    product_id: input.productId ?? null, variant_id: input.variantId ?? null, bundle_id: input.bundleId ?? null, space_id: input.spaceId ?? null,
    quantity: input.quantity ?? 1, unit_price_cents: unit, discount_cents: input.discountCents ?? 0,
    customer_notes: input.customerNotes ?? null, internal_notes: input.internalNotes ?? null, ...snap,
  }).select('id').single()
  if (error) return { ok: false as const, error: error.message }
  await recomputeTotals(c.tenantId, draftId)
  await addCommerceEvent(c.tenantId, 'draft', draftId, 'item_added', { itemId: data.id, productId: input.productId ?? null }, c.actor)
  return { ok: true as const, itemId: data.id as string }
}

export async function updateDraftItem(draftId: string, itemId: string, patch: { quantity?: number; unitPriceCents?: number; discountCents?: number; customerNotes?: string | null; spaceId?: string | null }) {
  const c = await requireCommerceAccess(); if (!c) return { ok: false as const, error: 'unauthorized' }
  const sb = await createClient()
  const m: Record<string, unknown> = {}
  if (patch.quantity != null) m.quantity = patch.quantity
  if (patch.unitPriceCents != null) m.unit_price_cents = patch.unitPriceCents
  if (patch.discountCents != null) m.discount_cents = patch.discountCents
  if ('customerNotes' in patch) m.customer_notes = patch.customerNotes
  if ('spaceId' in patch) m.space_id = patch.spaceId
  const { error } = await sb.from('commerce_draft_items').update(m).eq('tenant_id', c.tenantId).eq('id', itemId).eq('draft_id', draftId)
  if (error) return { ok: false as const, error: error.message }
  await recomputeTotals(c.tenantId, draftId)
  return { ok: true as const }
}

export async function removeDraftItem(draftId: string, itemId: string) {
  const c = await requireCommerceAccess(); if (!c) return { ok: false as const, error: 'unauthorized' }
  const sb = await createClient()
  const { error } = await sb.from('commerce_draft_items').delete().eq('tenant_id', c.tenantId).eq('id', itemId).eq('draft_id', draftId)
  if (error) return { ok: false as const, error: error.message }
  await recomputeTotals(c.tenantId, draftId)
  await addCommerceEvent(c.tenantId, 'draft', draftId, 'item_removed', { itemId }, c.actor)
  return { ok: true as const }
}

export async function listDrafts() {
  const c = await requireCommerceAccess(); if (!c) return []
  const sb = await createClient()
  const { data } = await sb.from('commerce_drafts').select('id, draft_number, name, customer_name, status, total_cents, currency, updated_at').eq('tenant_id', c.tenantId).order('updated_at', { ascending: false }).limit(200)
  return data ?? []
}
