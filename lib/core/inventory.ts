import { createAdminClient } from '@/lib/supabase/server'

// Core inventory: reserved/available model. Every quantity change goes through the atomic
// core_inventory_move RPC (levels + ledger updated together), so state and history never drift.
const admin = () => createAdminClient()

// available = on_hand − reserved (never stored). Pure, unit-tested.
export const available = (onHand: number, reserved: number): number => onHand - reserved

export type ItemKind = 'product' | 'variant' | 'component'
export type Movement = 'receive' | 'reserve' | 'release' | 'allocate' | 'ship' | 'return' | 'adjust'

export async function createLocation(tenantId: string, name: string, kind = 'warehouse') {
  const { data, error } = await admin().from('inventory_locations').insert({ tenant_id: tenantId, name, kind }).select('*').single()
  return error ? { ok: false as const, error: error.message } : { ok: true as const, location: data }
}
export async function listLocations(tenantId: string) {
  const { data } = await admin().from('inventory_locations').select('*').eq('tenant_id', tenantId).eq('is_active', true).order('name')
  return data ?? []
}
export async function getLevels(tenantId: string, itemKind: ItemKind, itemId: string) {
  const { data } = await admin().from('inventory_levels').select('*').eq('tenant_id', tenantId).eq('item_kind', itemKind).eq('item_id', itemId)
  return (data ?? []).map((l) => ({ ...l, available: available(Number(l.on_hand), Number(l.reserved)) }))
}

export type AvailabilityStatus = 'in_stock' | 'low_stock' | 'out_of_stock' | 'incoming' | 'made_to_order' | 'discontinued'

// Effective availability. An explicit status the tenant set always wins (e.g. made_to_order/discontinued);
// otherwise derive from available/incoming with a low-stock threshold. Pure, unit-tested.
export function deriveAvailability(availableQty: number, incomingQty: number, opts: { explicit?: string | null; threshold?: number; discontinued?: boolean } = {}): AvailabilityStatus {
  if (opts.explicit) return opts.explicit as AvailabilityStatus
  if (opts.discontinued) return 'discontinued'
  const threshold = opts.threshold ?? 0
  if (availableQty > threshold) return 'in_stock'
  if (availableQty > 0) return 'low_stock'
  if (incomingQty > 0) return 'incoming'
  return 'out_of_stock'
}

export interface ItemMeta { availability_status: string | null; low_stock_threshold: number; ai_notes: string | null; internal_notes: string | null; location_notes: string | null }
export interface IncomingRow { id: string; location_id: string | null; quantity: number; expected_arrival_date: string | null; supplier_ref: string | null; po_ref: string | null; notes: string | null; status: string }
export interface InventorySummary { onHand: number; reserved: number; available: number; incoming: number; nextArrival: string | null }

async function summarize(tenantId: string, itemKind: ItemKind, itemId: string): Promise<{ levels: Array<Record<string, unknown> & { available: number }>; incoming: IncomingRow[]; summary: InventorySummary }> {
  const [levels, { data: inc }] = await Promise.all([
    getLevels(tenantId, itemKind, itemId),
    admin().from('inventory_incoming').select('id, location_id, quantity, expected_arrival_date, supplier_ref, po_ref, notes, status').eq('tenant_id', tenantId).eq('item_kind', itemKind).eq('item_id', itemId).order('expected_arrival_date', { ascending: true }),
  ])
  const incoming = (inc ?? []) as IncomingRow[]
  const open = incoming.filter((r) => r.status === 'expected')
  const summary: InventorySummary = {
    onHand: levels.reduce((s, l) => s + Number(l.on_hand), 0), reserved: levels.reduce((s, l) => s + Number(l.reserved), 0), available: levels.reduce((s, l) => s + l.available, 0),
    incoming: open.reduce((s, r) => s + Number(r.quantity), 0), nextArrival: open.map((r) => r.expected_arrival_date).filter(Boolean).sort()[0] ?? null,
  }
  return { levels, incoming, summary }
}

// Full inventory view for one item: per-location levels, incoming shipments, notes, aggregate summary, and
// the effective availability status. For a component, also rolls up its variants (read-only summary — the
// component's own inventory is NOT overwritten).
export async function getItemInventory(tenantId: string, itemKind: ItemKind, itemId: string) {
  const [{ levels, incoming, summary }, locations, { data: metaRow }] = await Promise.all([
    summarize(tenantId, itemKind, itemId), listLocations(tenantId),
    admin().from('inventory_item_meta').select('availability_status, low_stock_threshold, ai_notes, internal_notes, location_notes').eq('tenant_id', tenantId).eq('item_kind', itemKind).eq('item_id', itemId).maybeSingle(),
  ])
  const meta: ItemMeta = { availability_status: (metaRow?.availability_status as string) ?? null, low_stock_threshold: Number(metaRow?.low_stock_threshold ?? 0), ai_notes: (metaRow?.ai_notes as string) ?? null, internal_notes: (metaRow?.internal_notes as string) ?? null, location_notes: (metaRow?.location_notes as string) ?? null }
  const availability = deriveAvailability(summary.available, summary.incoming, { explicit: meta.availability_status, threshold: meta.low_stock_threshold })

  let rollup: InventorySummary | null = null
  if (itemKind === 'component') {
    const { data: variants } = await admin().from('product_variants').select('id').eq('tenant_id', tenantId).eq('component_id', itemId)
    if (variants && variants.length) {
      const parts = await Promise.all(variants.map((v) => summarize(tenantId, 'variant', v.id as string)))
      rollup = parts.reduce((acc, p) => ({ onHand: acc.onHand + p.summary.onHand, reserved: acc.reserved + p.summary.reserved, available: acc.available + p.summary.available, incoming: acc.incoming + p.summary.incoming, nextArrival: [acc.nextArrival, p.summary.nextArrival].filter(Boolean).sort()[0] ?? null }),
        { onHand: summary.onHand, reserved: summary.reserved, available: summary.available, incoming: summary.incoming, nextArrival: summary.nextArrival } as InventorySummary)
    }
  }
  return { levels, locations, incoming, summary, meta, availability, rollup }
}

export async function setItemMeta(tenantId: string, itemKind: ItemKind, itemId: string, patch: Partial<ItemMeta>): Promise<{ ok: true } | { ok: false; error: string }> {
  const row: Record<string, unknown> = { tenant_id: tenantId, item_kind: itemKind, item_id: itemId, updated_at: new Date().toISOString() }
  for (const k of ['availability_status', 'low_stock_threshold', 'ai_notes', 'internal_notes', 'location_notes'] as const) if (patch[k] !== undefined) row[k] = patch[k]
  const { error } = await admin().from('inventory_item_meta').upsert(row, { onConflict: 'tenant_id,item_kind,item_id' })
  return error ? { ok: false, error: error.message } : { ok: true }
}

export interface IncomingInput { locationId?: string | null; quantity: number; expectedArrivalDate?: string | null; supplierRef?: string | null; poRef?: string | null; notes?: string | null }
export async function addIncoming(tenantId: string, itemKind: ItemKind, itemId: string, input: IncomingInput, actor: string): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  if (!(input.quantity > 0)) return { ok: false, error: 'quantity_must_be_positive' }
  const { data, error } = await admin().from('inventory_incoming').insert({ tenant_id: tenantId, item_kind: itemKind, item_id: itemId, location_id: input.locationId ?? null, quantity: input.quantity, expected_arrival_date: input.expectedArrivalDate ?? null, supplier_ref: input.supplierRef ?? null, po_ref: input.poRef ?? null, notes: input.notes ?? null, created_by: actor }).select('id').single()
  return error ? { ok: false, error: error.message } : { ok: true, id: data.id as string }
}
export async function cancelIncoming(tenantId: string, id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await admin().from('inventory_incoming').update({ status: 'cancelled', updated_at: new Date().toISOString() }).eq('tenant_id', tenantId).eq('id', id).eq('status', 'expected')
  return error ? { ok: false, error: error.message } : { ok: true }
}
// Receive a scheduled shipment: mark it received AND post an atomic ledger `receive` at its location.
export async function receiveIncoming(tenantId: string, id: string, actor: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data: row } = await admin().from('inventory_incoming').select('*').eq('tenant_id', tenantId).eq('id', id).maybeSingle()
  if (!row) return { ok: false, error: 'not_found' }
  if (row.status !== 'expected') return { ok: false, error: 'already_' + row.status }
  if (!row.location_id) return { ok: false, error: 'no_location' }
  const key = row.received_movement_key || `incoming:${id}:receive`
  const mv = await inventoryMove(tenantId, { itemKind: row.item_kind as ItemKind, itemId: row.item_id as string, locationId: row.location_id as string, movement: 'receive', quantity: Number(row.quantity), refType: 'incoming', refId: id, idempotencyKey: key }, actor)
  if (!mv.ok && !mv.idempotent) return { ok: false, error: mv.error || 'move_failed' }
  await admin().from('inventory_incoming').update({ status: 'received', received_movement_key: key, updated_at: new Date().toISOString() }).eq('tenant_id', tenantId).eq('id', id)
  return { ok: true }
}

export async function getLedger(tenantId: string, itemKind: ItemKind, itemId: string, limit = 50) {
  const { data } = await admin().from('inventory_ledger').select('id, location_id, movement, quantity, on_hand_after, reserved_after, reason, created_at').eq('tenant_id', tenantId).eq('item_kind', itemKind).eq('item_id', itemId).order('created_at', { ascending: false }).limit(limit)
  return data ?? []
}

export interface MoveInput { itemKind: ItemKind; itemId: string; locationId: string; movement: Movement; quantity: number; refType?: string | null; refId?: string | null; idempotencyKey?: string | null }
export async function inventoryMove(tenantId: string, m: MoveInput, actor: string) {
  const { data, error } = await admin().rpc('core_inventory_move', {
    p_tenant: tenantId, p_kind: m.itemKind, p_item: m.itemId, p_location: m.locationId, p_movement: m.movement,
    p_qty: m.quantity, p_ref_type: m.refType ?? null, p_ref_id: m.refId ?? null, p_key: m.idempotencyKey ?? null, p_actor: actor,
  })
  if (error) return { ok: false as const, error: error.message }
  return (data ?? { ok: false, error: 'no_result' }) as { ok: boolean; on_hand?: number; reserved?: number; available?: number; error?: string; idempotent?: boolean }
}
