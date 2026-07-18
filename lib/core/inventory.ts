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

export interface MoveInput { itemKind: ItemKind; itemId: string; locationId: string; movement: Movement; quantity: number; refType?: string | null; refId?: string | null; idempotencyKey?: string | null }
export async function inventoryMove(tenantId: string, m: MoveInput, actor: string) {
  const { data, error } = await admin().rpc('core_inventory_move', {
    p_tenant: tenantId, p_kind: m.itemKind, p_item: m.itemId, p_location: m.locationId, p_movement: m.movement,
    p_qty: m.quantity, p_ref_type: m.refType ?? null, p_ref_id: m.refId ?? null, p_key: m.idempotencyKey ?? null, p_actor: actor,
  })
  if (error) return { ok: false as const, error: error.message }
  return (data ?? { ok: false, error: 'no_result' }) as { ok: boolean; on_hand?: number; reserved?: number; available?: number; error?: string; idempotent?: boolean }
}
