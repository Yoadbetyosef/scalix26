import { createClient, createAdminClient } from '@/lib/supabase/server'
import { requireCommerceAccess } from './guard'
import type { Availability, BundleAvailability, CommerceLocation, InventoryLevel, ItemKind, MovementType } from './types'

// ── Pure: how many complete bundles can be built from component availabilities (§3). Unit-tested. ──
export function computeBundleBuildable(
  components: Array<{ itemKind: ItemKind; itemId: string; perBundle: number; available: number }>,
): BundleAvailability {
  if (!components.length) return { buildable: 0, components: [] }
  const withSets = components.map((c) => ({ ...c, sets: c.perBundle > 0 ? Math.floor(c.available / c.perBundle) : Number.POSITIVE_INFINITY }))
  const buildable = Math.min(...withSets.map((c) => c.sets))
  const finiteBuildable = Number.isFinite(buildable) ? buildable : 0
  return {
    buildable: finiteBuildable,
    components: withSets.map((c) => ({ itemKind: c.itemKind, itemId: c.itemId, perBundle: c.perBundle, available: c.available, limiting: c.sets === buildable })),
  }
}

// ── Pure: available is on_hand - reserved, never negative below zero at the display layer. ──
export const availableOf = (onHand: number, reserved: number): number => onHand - reserved

const levelRow = (r: Record<string, unknown>): InventoryLevel => ({
  id: r.id as string, itemKind: r.item_kind as ItemKind, itemId: r.item_id as string, locationId: r.location_id as string,
  onHand: Number(r.on_hand ?? 0), reserved: Number(r.reserved ?? 0), available: Number(r.available ?? 0),
  incoming: Number(r.incoming ?? 0), damaged: Number(r.damaged ?? 0), allocated: Number(r.allocated ?? 0),
  floorDisplay: Number(r.floor_display ?? 0), expectedArrivalDate: (r.expected_arrival_date as string) ?? null,
})

export async function createLocation(input: { name: string; type: string }): Promise<{ ok: true; location: CommerceLocation } | { ok: false; error: string }> {
  const c = await requireCommerceAccess(); if (!c) return { ok: false, error: 'unauthorized' }
  const sb = await createClient()
  const { data, error } = await sb.from('commerce_locations').insert({ tenant_id: c.tenantId, name: input.name.trim(), type: input.type }).select('id,name,type,is_default,is_active').single()
  if (error) return { ok: false, error: error.message }
  return { ok: true, location: { id: data.id as string, name: data.name as string, type: data.type as CommerceLocation['type'], isDefault: !!data.is_default, isActive: !!data.is_active } }
}

export async function listLocations(): Promise<CommerceLocation[]> {
  const c = await requireCommerceAccess(); if (!c) return []
  const sb = await createClient()
  const { data } = await sb.from('commerce_locations').select('id,name,type,is_default,is_active').eq('tenant_id', c.tenantId).order('name')
  return ((data as Array<Record<string, unknown>>) ?? []).map((r) => ({ id: r.id as string, name: r.name as string, type: r.type as CommerceLocation['type'], isDefault: !!r.is_default, isActive: !!r.is_active }))
}

// All inventory levels for one stock item across locations.
export async function levelsForItem(itemKind: ItemKind, itemId: string): Promise<InventoryLevel[]> {
  const c = await requireCommerceAccess(); if (!c) return []
  const sb = await createClient()
  const { data } = await sb.from('commerce_inventory_levels').select('*').eq('tenant_id', c.tenantId).eq('item_kind', itemKind).eq('item_id', itemId)
  return ((data as Array<Record<string, unknown>>) ?? []).map(levelRow)
}

// Aggregate availability across all locations for a stock item.
export async function availabilityForItem(itemKind: ItemKind, itemId: string): Promise<Availability> {
  const levels = await levelsForItem(itemKind, itemId)
  const sum = (k: keyof InventoryLevel) => levels.reduce((s, l) => s + (l[k] as number), 0)
  const arrivals = levels.map((l) => l.expectedArrivalDate).filter(Boolean).sort() as string[]
  return { onHand: sum('onHand'), reserved: sum('reserved'), available: sum('available'), incoming: sum('incoming'), expectedArrivalDate: arrivals[0] ?? null }
}

// Record an inventory movement AND apply the delta to the level bucket — never mutate a quantity
// without writing a ledger row (§8). Phase 1 uses this for opening_balance / manual_adjustment /
// damage. Concurrency-critical decrements (reservations) go through the reserve_inventory RPC (Phase 2).
// `field` is the level column the delta applies to (default on_hand).
export async function recordMovement(input: {
  itemKind: ItemKind; itemId: string; locationId: string; movementType: MovementType; delta: number;
  field?: 'on_hand' | 'incoming' | 'damaged' | 'allocated' | 'floor_display';
  reason?: string; note?: string; referenceType?: string; referenceId?: string;
}): Promise<{ ok: true; before: number; after: number } | { ok: false; error: string }> {
  const c = await requireCommerceAccess(); if (!c) return { ok: false, error: 'unauthorized' }
  const field = input.field ?? 'on_hand'
  // Approved server path: write via the service role (authenticated/anon clients have NO write privilege
  // on the inventory tables — see add_commerce_3_inventory_lockdown.sql). Tenant is already validated;
  // every query below is explicitly scoped by tenant_id since the admin client bypasses RLS.
  const sb = createAdminClient()
  // Ensure the level row exists.
  const { data: existing } = await sb.from('commerce_inventory_levels').select('*').eq('tenant_id', c.tenantId).eq('item_kind', input.itemKind).eq('item_id', input.itemId).eq('location_id', input.locationId).maybeSingle()
  const before = existing ? Number((existing as Record<string, unknown>)[field] ?? 0) : 0
  const after = before + input.delta
  if (after < 0) return { ok: false, error: `Adjustment would make ${field} negative (have ${before}, delta ${input.delta}).` }

  if (existing) {
    const { error } = await sb.from('commerce_inventory_levels').update({ [field]: after, updated_at: new Date().toISOString() }).eq('tenant_id', c.tenantId).eq('id', (existing as { id: string }).id)
    if (error) return { ok: false, error: error.message }
  } else {
    const { error } = await sb.from('commerce_inventory_levels').insert({ tenant_id: c.tenantId, item_kind: input.itemKind, item_id: input.itemId, location_id: input.locationId, [field]: after })
    if (error) return { ok: false, error: error.message }
  }
  const { error: movErr } = await sb.from('commerce_inventory_movements').insert({
    tenant_id: c.tenantId, item_kind: input.itemKind, item_id: input.itemId, location_id: input.locationId,
    movement_type: input.movementType, quantity: input.delta, reason: input.reason ?? null, note: input.note ?? null,
    reference_type: input.referenceType ?? null, reference_id: input.referenceId ?? null, before_qty: before, after_qty: after, created_by: c.actor,
  })
  if (movErr) return { ok: false, error: movErr.message }
  await sb.from('commerce_events').insert({ tenant_id: c.tenantId, entity_type: 'inventory', entity_id: input.itemId, type: input.movementType, payload: { field, before, after, delta: input.delta, locationId: input.locationId }, actor: c.actor })
  return { ok: true, before, after }
}
