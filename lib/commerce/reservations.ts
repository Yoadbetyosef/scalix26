import { createClient, createAdminClient } from '@/lib/supabase/server'
import { requireCommerceAccess } from './guard'
import { reservationIdempotencyKey } from './number'

export interface ReserveResult {
  ok: boolean
  reservationId?: string
  idempotent?: boolean
  error?: string
  // shortfall detail (§5) when insufficient
  requested?: number
  available?: number
  missing?: number
  incoming?: number
  expectedArrival?: string | null
}

// Resolve the tenant's default reservation expiry (§5). Modes: fixed hours | until draft expiration |
// none. Returns an ISO timestamp or null (no expiration).
async function resolveExpiry(tenantId: string, draftExpiration: string | null): Promise<string | null> {
  const sb = await createClient()
  const { data } = await sb.from('commerce_settings').select('default_reservation_hours, reservation_mode').eq('tenant_id', tenantId).maybeSingle()
  const mode = data?.reservation_mode ?? 'hours'
  if (mode === 'no_expiration') return null
  if (mode === 'until_draft_expiration') return draftExpiration ? new Date(`${draftExpiration}T23:59:59Z`).toISOString() : null
  const hours = data?.default_reservation_hours ?? 48
  return new Date(Date.now() + hours * 3600_000).toISOString()
}

// Reserve inventory for a draft's line item via the atomic, idempotent, no-oversell RPC. Never reduces
// on_hand; it moves quantity into `reserved`. Idempotency key = (draft,item,location) so repeated clicks
// don't double-reserve. Returns shortfall detail when insufficient so the UI can show exactly what's missing.
export async function reserveForDraft(input: {
  draftId: string; itemKind: 'product' | 'variant'; itemId: string; locationId: string; quantity: number; draftExpiration?: string | null
}): Promise<ReserveResult> {
  const c = await requireCommerceAccess(); if (!c) return { ok: false, error: 'unauthorized' }
  const expiresAt = await resolveExpiry(c.tenantId, input.draftExpiration ?? null)
  const key = reservationIdempotencyKey(input.draftId, input.itemKind, input.itemId, input.locationId)
  const admin = createAdminClient()
  const { data, error } = await admin.rpc('reserve_inventory', {
    p_tenant: c.tenantId, p_item_kind: input.itemKind, p_item_id: input.itemId, p_location_id: input.locationId,
    p_qty: input.quantity, p_draft_id: input.draftId, p_order_id: null, p_expires_at: expiresAt, p_idempotency_key: key, p_created_by: c.actor,
  })
  if (error) return { ok: false, error: error.message }
  const r = (data ?? {}) as Record<string, unknown>
  if (!r.ok) {
    return { ok: false, error: (r.error as string) ?? 'reservation_failed', requested: r.requested as number, available: r.available as number, missing: r.missing as number, incoming: r.incoming as number, expectedArrival: (r.expected_arrival as string) ?? null }
  }
  await admin.from('commerce_events').insert({ tenant_id: c.tenantId, entity_type: 'reservation', entity_id: r.reservation_id as string, type: r.idempotent ? 'reservation_idempotent' : 'reservation_created', payload: { draftId: input.draftId, itemId: input.itemId, quantity: input.quantity }, actor: c.actor })
  return { ok: true, reservationId: r.reservation_id as string, idempotent: !!r.idempotent }
}

export async function releaseReservation(reservationId: string, reason: string): Promise<{ ok: boolean; error?: string }> {
  const c = await requireCommerceAccess(); if (!c) return { ok: false, error: 'unauthorized' }
  const admin = createAdminClient()
  const { data, error } = await admin.rpc('release_reservation', { p_tenant: c.tenantId, p_reservation_id: reservationId, p_reason: reason, p_released_by: c.actor, p_new_status: 'released' })
  if (error) return { ok: false, error: error.message }
  const r = (data ?? {}) as Record<string, unknown>
  if (!r.ok) return { ok: false, error: (r.error as string) ?? 'release_failed' }
  await admin.from('commerce_events').insert({ tenant_id: c.tenantId, entity_type: 'reservation', entity_id: reservationId, type: 'reservation_released', payload: { reason }, actor: c.actor })
  return { ok: true }
}

export async function listReservationsForDraft(draftId: string) {
  const c = await requireCommerceAccess(); if (!c) return []
  const sb = await createClient()
  const { data } = await sb.from('commerce_reservations').select('id,item_kind,item_id,location_id,quantity,status,expires_at').eq('tenant_id', c.tenantId).eq('draft_id', draftId).order('created_at', { ascending: false })
  return data ?? []
}
