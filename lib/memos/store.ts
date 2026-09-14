import { createAdminClient } from '@/lib/supabase/server'
import { requireActiveBusinessContext } from '@/lib/workspace'
import { canMemoTransition, type Memo, type MemoEvent, type MemoInput, type MemoStatus } from './types'

// Server-only memo data access. Every write also writes the inventory side — the catalog counters
// and a catalog_movements row — in the same function, so a memo's status and the stock it describes
// cannot disagree. See lib/memos/types.ts for the model.
//
// The admin client under an explicit tenant filter, like the catalog's own movement route: the
// catalog tables are RLS-locked with no user policy, so the cookie client cannot reach them.

export const MEMOS_MIGRATION = 'add_tg_production_1.sql'

interface Ctx { tenantId: string; actor: string }
async function ctx(): Promise<Ctx | null> {
  const c = await requireActiveBusinessContext()
  return c ? { tenantId: c.tenantId, actor: c.actorUserId } : null
}
const num = (v: unknown): number | null => (v === null || v === undefined || v === '' ? null : Number(v))

const row = (r: Record<string, unknown>): Memo => ({
  id: r.id as string, tenantId: r.tenant_id as string, kind: r.kind as Memo['kind'], direction: r.direction as Memo['direction'], status: r.status as MemoStatus,
  catalogProductId: (r.catalog_product_id as string) ?? null, itemDescription: r.item_description as string, quantity: Number(r.quantity ?? 1), fromLocation: (r.from_location as string) ?? null,
  contactId: (r.contact_id as string) ?? null, supplierId: (r.supplier_id as string) ?? null, counterpartyName: (r.counterparty_name as string) ?? null,
  owner: r.owner as Memo['owner'],
  agreedPriceCents: num(r.agreed_price_cents), costCents: num(r.cost_cents), currency: (r.currency as string) ?? 'usd',
  movedOn: r.moved_on as string, dueOn: (r.due_on as string) ?? null, soldOn: (r.sold_on as string) ?? null, returnedOn: (r.returned_on as string) ?? null,
  soldPriceCents: num(r.sold_price_cents), settledAt: (r.settled_at as string) ?? null,
  orderId: (r.order_id as string) ?? null, notes: (r.notes as string) ?? null,
  createdBy: (r.created_by as string) ?? null, createdAt: r.created_at as string, updatedAt: r.updated_at as string,
})
const eventRow = (r: Record<string, unknown>): MemoEvent => ({ id: r.id as string, memoId: r.memo_id as string, type: r.type as string, actor: (r.actor as string) ?? null, payload: (r.payload as Record<string, unknown>) ?? null, createdAt: r.created_at as string })

/** Every memo for the tenant, open first, then by follow-up date. */
export async function listMemos(): Promise<{ memos: Memo[]; missing: boolean }> {
  const c = await ctx(); if (!c) return { memos: [], missing: false }
  const { data, error } = await createAdminClient().from('memos').select('*').eq('tenant_id', c.tenantId)
    .order('status').order('due_on', { ascending: true, nullsFirst: false }).order('created_at', { ascending: false })
  if (error) return { memos: [], missing: error.code === '42P01' || error.code === 'PGRST205' }
  return { memos: ((data as Array<Record<string, unknown>> | null) ?? []).map(row), missing: false }
}

export async function getMemo(id: string): Promise<{ memo: Memo; events: MemoEvent[] } | null> {
  const c = await ctx(); if (!c) return null
  const db = createAdminClient()
  const { data } = await db.from('memos').select('*').eq('tenant_id', c.tenantId).eq('id', id).maybeSingle()
  if (!data) return null
  const { data: ev } = await db.from('memo_events').select('*').eq('memo_id', id).order('created_at', { ascending: false })
  return { memo: row(data as Record<string, unknown>), events: ((ev as Array<Record<string, unknown>> | null) ?? []).map(eventRow) }
}

/** Memos belonging to one customer, for their history. Tenant given explicitly. */
export async function listMemosForContact(tenantId: string, contactId: string): Promise<Memo[]> {
  const { data } = await createAdminClient().from('memos').select('*').eq('tenant_id', tenantId).eq('contact_id', contactId).order('created_at', { ascending: false })
  return ((data as Array<Record<string, unknown>> | null) ?? []).map(row)
}

async function addMemoEvent(tenantId: string, memoId: string, type: string, payload: Record<string, unknown> | null, actor: string) {
  await createAdminClient().from('memo_events').insert({ tenant_id: tenantId, memo_id: memoId, type, actor, payload })
}

// ── THE INVENTORY SIDE ──────────────────────────────────────────────────────────────────────────

type Loc = 'showroom' | 'warehouse' | 'storage'
const COL: Record<Loc, 'showroom_quantity' | 'warehouse_quantity' | 'storage_quantity'> = { showroom: 'showroom_quantity', warehouse: 'warehouse_quantity', storage: 'storage_quantity' }
const asLoc = (v: unknown): Loc | null => (v === 'showroom' || v === 'warehouse' || v === 'storage' ? v : null)
const clamp = (n: number) => Math.max(0, Math.trunc(n))

/** Recompute availability the way the catalog's own movement route does. */
function availabilityOf(p: Record<string, unknown>, q: Record<Loc, number>): string {
  const total = q.showroom + q.warehouse + q.storage
  const availability = p.availability_status as string
  if (availability === 'special_order') return availability
  return total > 0 ? 'in_stock' : Number(p.incoming_quantity ?? 0) > 0 ? 'incoming' : 'out_of_stock'
}

/**
 * Move `qty` of a product between a location and on-memo, or back, writing the movement row.
 * `sign` +1 sends out (location → on memo), −1 brings back (on memo → location).
 */
async function moveStockForMemo(tenantId: string, productId: string, qty: number, loc: Loc, sign: 1 | -1, movementType: string, note: string, actor: string): Promise<{ ok: boolean; error?: string }> {
  const db = createAdminClient()
  const { data: p } = await db.from('catalog_products').select('*').eq('tenant_id', tenantId).eq('id', productId).maybeSingle()
  if (!p) return { ok: false, error: 'That product no longer exists.' }
  const q: Record<Loc, number> = { showroom: Number(p.showroom_quantity ?? 0), warehouse: Number(p.warehouse_quantity ?? 0), storage: Number(p.storage_quantity ?? 0) }
  const onMemo = Number(p.on_memo_quantity ?? 0)
  if (sign === 1) {
    if (q[loc] < qty) return { ok: false, error: `Only ${q[loc]} in ${loc} — cannot send ${qty} on memo.` }
    q[loc] = clamp(q[loc] - qty)
  } else {
    q[loc] = clamp(q[loc] + qty)
  }
  const nextOnMemo = clamp(onMemo + sign * qty)
  const { error } = await db.from('catalog_products').update({
    [COL.showroom]: q.showroom, [COL.warehouse]: q.warehouse, [COL.storage]: q.storage,
    on_memo_quantity: nextOnMemo, availability_status: availabilityOf(p as Record<string, unknown>, q), updated_at: new Date().toISOString(),
  }).eq('tenant_id', tenantId).eq('id', productId)
  if (error) return { ok: false, error: error.message }
  await db.from('catalog_movements').insert({
    tenant_id: tenantId, product_id: productId, movement_type: movementType, quantity: qty,
    from_location: sign === 1 ? loc : null, to_location: sign === 1 ? null : loc, note, created_by: actor,
  })
  return { ok: true }
}

// ── WRITES ──────────────────────────────────────────────────────────────────────────────────────

export async function createMemo(input: MemoInput): Promise<{ ok: boolean; error?: string; memo?: Memo }> {
  const c = await ctx(); if (!c) return { ok: false, error: 'Not signed in' }
  const db = createAdminClient()
  const qty = clamp(input.quantity ?? 1) || 1
  const kind = input.kind ?? 'memo'
  const loc = asLoc(input.fromLocation) ?? 'showroom'
  const desc = (input.itemDescription ?? '').trim()
  let productId = input.catalogProductId ?? null
  let itemDescription = desc

  if (input.direction === 'out') {
    // Ours, going out: it must be a product we hold.
    if (!productId) return { ok: false, error: 'Choose the stock item being sent out on memo.' }
    const { data: p } = await db.from('catalog_products').select('id, name, sku, ownership').eq('tenant_id', c.tenantId).eq('id', productId).maybeSingle()
    if (!p) return { ok: false, error: 'That product was not found.' }
    if (p.ownership && p.ownership !== 'owned') return { ok: false, error: 'That piece is itself on memo or consignment from a supplier and cannot be sent out on memo.' }
    itemDescription = itemDescription || [p.name, p.sku ? `(${p.sku})` : null].filter(Boolean).join(' ')
  } else {
    // Theirs, coming in: entered as stock we can sell but do not own.
    if (!itemDescription) return { ok: false, error: 'Describe the piece received.' }
    if (!input.supplierId && !(input.counterpartyName ?? '').trim()) return { ok: false, error: 'Say who the piece belongs to.' }
    if (input.stockIt !== false && !productId) {
      const { data: created, error } = await db.from('catalog_products').insert({
        tenant_id: c.tenantId, name: itemDescription.slice(0, 200), status: 'active', availability_status: 'in_stock',
        [COL[loc]]: qty, ownership: kind === 'consignment' ? 'consignment' : 'memo_in',
        price: input.agreedPriceCents != null ? input.agreedPriceCents / 100 : null,
        internal_notes: `${kind === 'consignment' ? 'On consignment' : 'On memo'} from ${(input.counterpartyName ?? '').trim() || 'supplier'} — not company stock`,
      }).select('id').single()
      if (error) {
        if (error.code === '42703' || error.code === 'PGRST204') return { ok: false, error: `Run ${MEMOS_MIGRATION} in the Supabase SQL editor first — the catalog does not know about ownership yet.` }
        return { ok: false, error: error.message }
      }
      productId = created.id as string
      await db.from('catalog_movements').insert({ tenant_id: c.tenantId, product_id: productId, movement_type: 'memo_in', quantity: qty, to_location: loc, note: `Received on ${kind} from ${(input.counterpartyName ?? '').trim() || 'supplier'}`, created_by: c.actor })
    }
  }

  const { data, error } = await db.from('memos').insert({
    tenant_id: c.tenantId, kind, direction: input.direction, status: 'open',
    catalog_product_id: productId, item_description: itemDescription, quantity: qty, from_location: loc,
    contact_id: input.contactId ?? null, supplier_id: input.supplierId ?? null, counterparty_name: (input.counterpartyName ?? '').trim() || null,
    owner: input.direction === 'out' ? 'company' : 'counterparty',
    agreed_price_cents: input.agreedPriceCents ?? null, cost_cents: input.costCents ?? null, currency: input.currency ?? 'usd',
    moved_on: input.movedOn || new Date().toISOString().slice(0, 10), due_on: input.dueOn || null, notes: (input.notes ?? '').trim() || null,
    created_by: c.actor,
  }).select('*').single()
  if (error) {
    if (error.code === '42P01' || error.code === 'PGRST205') return { ok: false, error: `Run ${MEMOS_MIGRATION} in the Supabase SQL editor first — the memos table does not exist yet.` }
    return { ok: false, error: error.message }
  }
  const memo = row(data as Record<string, unknown>)

  if (input.direction === 'out' && productId) {
    const moved = await moveStockForMemo(c.tenantId, productId, qty, loc, 1, 'memo_out', `Sent on ${kind} to ${memo.counterpartyName ?? 'customer'}`, c.actor)
    if (!moved.ok) {
      // The stock could not leave, so the memo does not exist either — a memo for stock still on
      // the shelf is the disagreement this module exists to prevent.
      await db.from('memos').delete().eq('id', memo.id)
      return { ok: false, error: moved.error }
    }
  }
  await addMemoEvent(c.tenantId, memo.id, 'created', { direction: memo.direction, kind, quantity: qty, productId }, c.actor)
  return { ok: true, memo }
}

export interface MemoTransitionInput {
  to: MemoStatus
  note?: string | null
  /** For 'sold': the price it went for, and optionally the order that carries the sale. */
  soldPriceCents?: number | null
  orderId?: string | null
  /** For 'returned' on an OUT memo: where it goes back to. Default: where it came from. */
  toLocation?: string | null
  /** For 'follow_up': a new follow-up date. */
  dueOn?: string | null
}

/**
 * Move a memo to a new status, with the stock effect that status implies:
 *
 *   out + returned   the piece comes back to its location and off on-memo
 *   out + sold       it leaves on-memo for good (a sale), the order is linked if given
 *   in  + returned   quantity to zero, product archived — no longer available, never was ours
 *   in  + sold       quantity down by the memo's count; the memo records price and settlement
 *   follow_up / pending_decision   no stock effect; a date and a note
 */
export async function transitionMemo(id: string, input: MemoTransitionInput): Promise<{ ok: boolean; error?: string; memo?: Memo }> {
  const c = await ctx(); if (!c) return { ok: false, error: 'Not signed in' }
  const db = createAdminClient()
  const { data } = await db.from('memos').select('*').eq('tenant_id', c.tenantId).eq('id', id).maybeSingle()
  if (!data) return { ok: false, error: 'Memo not found' }
  const m = row(data as Record<string, unknown>)
  if (!canMemoTransition(m.status, input.to)) return { ok: false, error: `A memo that is ${m.status.replace('_', ' ')} cannot move to ${input.to.replace('_', ' ')}.` }

  const today = new Date().toISOString().slice(0, 10)
  const patch: Record<string, unknown> = { status: input.to, updated_at: new Date().toISOString() }
  if (input.to === 'follow_up' && input.dueOn) patch.due_on = input.dueOn
  if (input.to === 'sold') { patch.sold_on = today; patch.sold_price_cents = input.soldPriceCents ?? m.agreedPriceCents; if (input.orderId) patch.order_id = input.orderId }
  if (input.to === 'returned') patch.returned_on = today

  // Stock first, then the status: if the stock cannot move the status must not claim it did.
  if (m.catalogProductId) {
    const loc = asLoc(input.toLocation) ?? asLoc(m.fromLocation) ?? 'showroom'
    if (m.direction === 'out' && input.to === 'returned') {
      const r = await moveStockForMemo(c.tenantId, m.catalogProductId, m.quantity, loc, -1, 'memo_return', `Returned from ${m.kind} by ${m.counterpartyName ?? 'customer'}`, c.actor)
      if (!r.ok) return r
    }
    if (m.direction === 'out' && input.to === 'sold') {
      // Off on-memo, and not back into any location: it is sold.
      const { data: p } = await db.from('catalog_products').select('on_memo_quantity').eq('tenant_id', c.tenantId).eq('id', m.catalogProductId).maybeSingle()
      await db.from('catalog_products').update({ on_memo_quantity: clamp(Number(p?.on_memo_quantity ?? 0) - m.quantity), updated_at: new Date().toISOString() }).eq('tenant_id', c.tenantId).eq('id', m.catalogProductId)
      await db.from('catalog_movements').insert({ tenant_id: c.tenantId, product_id: m.catalogProductId, movement_type: 'sell', quantity: m.quantity, from_location: null, note: `Sold from ${m.kind} to ${m.counterpartyName ?? 'customer'}`, created_by: c.actor })
    }
    if (m.direction === 'in' && input.to === 'returned') {
      // It was never ours. Quantity to zero and the row archived, so it stops appearing available.
      await db.from('catalog_products').update({ showroom_quantity: 0, warehouse_quantity: 0, storage_quantity: 0, availability_status: 'out_of_stock', archived_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('tenant_id', c.tenantId).eq('id', m.catalogProductId)
      await db.from('catalog_movements').insert({ tenant_id: c.tenantId, product_id: m.catalogProductId, movement_type: 'memo_return_supplier', quantity: m.quantity, from_location: loc, note: `Returned to ${m.counterpartyName ?? 'supplier'}`, created_by: c.actor })
    }
    if (m.direction === 'in' && input.to === 'sold') {
      const { data: p } = await db.from('catalog_products').select('*').eq('tenant_id', c.tenantId).eq('id', m.catalogProductId).maybeSingle()
      if (p) {
        const q: Record<Loc, number> = { showroom: Number(p.showroom_quantity ?? 0), warehouse: Number(p.warehouse_quantity ?? 0), storage: Number(p.storage_quantity ?? 0) }
        q[loc] = clamp(q[loc] - m.quantity)
        await db.from('catalog_products').update({ [COL.showroom]: q.showroom, [COL.warehouse]: q.warehouse, [COL.storage]: q.storage, availability_status: availabilityOf(p as Record<string, unknown>, q), updated_at: new Date().toISOString() }).eq('tenant_id', c.tenantId).eq('id', m.catalogProductId)
        await db.from('catalog_movements').insert({ tenant_id: c.tenantId, product_id: m.catalogProductId, movement_type: 'sell', quantity: m.quantity, from_location: loc, note: `Sold — ${m.kind} piece from ${m.counterpartyName ?? 'supplier'}`, created_by: c.actor })
      }
    }
  }

  const { data: updated, error } = await db.from('memos').update(patch).eq('tenant_id', c.tenantId).eq('id', id).select('*').single()
  if (error) return { ok: false, error: error.message }
  await addMemoEvent(c.tenantId, id, 'status_changed', { from: m.status, to: input.to, note: (input.note ?? '').trim() || null, soldPriceCents: patch.sold_price_cents ?? null, orderId: input.orderId ?? null }, c.actor)
  return { ok: true, memo: row(updated as Record<string, unknown>) }
}

/** Mark a sold IN memo settled with the supplier (they have been paid their share). */
export async function settleMemo(id: string): Promise<{ ok: boolean; error?: string }> {
  const c = await ctx(); if (!c) return { ok: false, error: 'Not signed in' }
  const db = createAdminClient()
  const { data, error } = await db.from('memos').update({ settled_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('tenant_id', c.tenantId).eq('id', id).eq('status', 'sold').is('settled_at', null).select('id')
  if (error) return { ok: false, error: error.message }
  if (!data?.length) return { ok: false, error: 'Only a sold memo that is not yet settled can be settled.' }
  await addMemoEvent(c.tenantId, id, 'settled', null, c.actor)
  return { ok: true }
}
