import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { requireCatalogTenant } from '@/lib/catalog/session'
import { LOCATIONS, MOVEMENT_TYPES, type Location, type MovementType } from '@/lib/catalog/types'

const COL: Record<Location, 'showroom_quantity' | 'warehouse_quantity' | 'storage_quantity'> = {
  showroom: 'showroom_quantity', warehouse: 'warehouse_quantity', storage: 'storage_quantity',
}
const validLoc = (v: unknown): v is Location => typeof v === 'string' && (LOCATIONS as readonly string[]).includes(v)
const clamp = (n: number) => Math.max(0, Math.trunc(n))

// POST /api/catalog/products/[id]/movement — receive / move / sell / adjust / return.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const s = await requireCatalogTenant()
  if (!s) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { id } = await params

  let body: { movement_type?: string; quantity?: unknown; from_location?: unknown; to_location?: unknown; note?: unknown }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  const type = body.movement_type as MovementType
  if (!(MOVEMENT_TYPES as readonly string[]).includes(type)) return NextResponse.json({ error: 'invalid movement_type' }, { status: 400 })
  const qty = clamp(Number(body.quantity))
  const from = validLoc(body.from_location) ? body.from_location : null
  const to = validLoc(body.to_location) ? body.to_location : null
  const note = typeof body.note === 'string' ? body.note.trim() || null : null

  const db = createAdminClient()
  const { data: p } = await db.from('catalog_products').select('*').eq('id', id).eq('tenant_id', s.tenantId).maybeSingle()
  if (!p) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const q = { showroom: p.showroom_quantity, warehouse: p.warehouse_quantity, storage: p.storage_quantity } as Record<Location, number>
  let incoming = p.incoming_quantity as number

  if (type === 'receive') {
    const dest = to || 'warehouse'
    q[dest] = clamp(q[dest] + qty)
    if (incoming > 0) incoming = clamp(incoming - qty) // received against an incoming shipment
  } else if (type === 'move') {
    if (!from || !to) return NextResponse.json({ error: 'move needs from + to location' }, { status: 400 })
    q[from] = clamp(q[from] - qty); q[to] = clamp(q[to] + qty)
  } else if (type === 'sell') {
    const src = from || 'showroom'
    q[src] = clamp(q[src] - qty)
  } else if (type === 'return') {
    const dest = to || 'showroom'
    q[dest] = clamp(q[dest] + qty)
  } else if (type === 'adjust') {
    const dest = to || from || 'warehouse'
    q[dest] = clamp(qty) // absolute correction to a location
  }

  const total = q.showroom + q.warehouse + q.storage
  // Auto-derive availability (keep a manual special_order as-is).
  let availability = p.availability_status
  if (availability !== 'special_order') availability = total > 0 ? 'in_stock' : incoming > 0 ? 'incoming' : 'out_of_stock'

  const { error: upErr } = await db.from('catalog_products').update({
    showroom_quantity: q.showroom, warehouse_quantity: q.warehouse, storage_quantity: q.storage,
    incoming_quantity: incoming, availability_status: availability, updated_at: new Date().toISOString(),
  }).eq('id', id).eq('tenant_id', s.tenantId)
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 })

  await db.from('catalog_movements').insert({
    tenant_id: s.tenantId, product_id: id, movement_type: type, quantity: qty,
    from_location: from, to_location: to, note, created_by: s.email,
  })

  return NextResponse.json({ ok: true })
}
