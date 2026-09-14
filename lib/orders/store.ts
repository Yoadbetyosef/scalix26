import { createClient, createAdminClient } from '@/lib/supabase/server'
import { requireActiveBusinessContext } from '@/lib/workspace'
import { ORDER_BUCKET } from './attachments'
import { generateOrderNumber } from './order-number'
import { canManualTransition, STAGE_LABELS, type OrderStage } from './stages'
import { taxChoiceById } from '@/lib/tax/canada'
import { isMissingColumn } from '@/lib/db/missing-column'
import { resolveContactForOrder } from './link-contact'
import { orderRow, lineRow, lineExtras, lineInsert } from './rows'
import { getSchemaCapabilities, stageSupported } from '@/lib/db/capabilities'
import type { Order, OrderEvent, OrderWithDetails, OrderInput, LineItemInput } from './types'

// Server-only Orders data access. Every call resolves the validated active tenant (requireActiveBusinessContext)
// and queries through the RLS-scoped authenticated client, so a tenant can only ever touch its own orders.
// The Orders module must be enabled for the tenant (route guards + API handlers check that separately).

export interface OrderCtx { tenantId: string; actor: string }
async function ctx(): Promise<OrderCtx | null> {
  const c = await requireActiveBusinessContext()
  if (!c) return null
  return { tenantId: c.tenantId, actor: c.actorUserId }
}

/**
 * Write a whole order's line items, dropping the new columns if the database has not been told about
 * them yet.
 *
 * ── WHY THIS DROPS RATHER THAN REFUSES ──────────────────────────────────────────────────────────
 *
 * lib/contacts/company-column.ts refuses the equivalent write, and is right to: a company name typed
 * into a form and silently discarded is data the owner believes is saved. The judgement is different
 * here and the reason is what the two fields are worth against what they are attached to.
 *
 * A line item carries the piece — its name, its price, its stones, its metal. Refusing the whole save
 * because a band width could not be stored would lose ALL of that to protect one number, on a form
 * where the order is the thing being written. So the extras are dropped and everything else lands.
 *
 * It is not silent: `degraded` comes back to the caller, which turns it into a sentence naming the
 * migration. The owner is told the width did not save, on the same screen, immediately — which is the
 * property that actually matters, and it is one a refusal is not required to deliver.
 */
async function insertLines(
  sb: Awaited<ReturnType<typeof createClient>>,
  tenantId: string, orderId: string, items: LineItemInput[], totals: number[],
): Promise<{ error: { message: string } | null; degraded: boolean }> {
  const rows = items.map((i, idx) => ({ ...lineInsert(tenantId, orderId, i, totals[idx], idx), ...lineExtras(i) }))
  const { error } = await sb.from('order_line_items').insert(rows)
  if (!isMissingColumn(error, 'side_stone_shapes', 'band_width_mm')) return { error, degraded: false }

  // The one retry, without the new columns. `side_stone_shape` (singular) is still populated from the
  // array's first entry inside lineInsert, so an unmigrated database keeps recording ONE side shape
  // exactly as it always has rather than none.
  const legacy = items.map((i, idx) => lineInsert(tenantId, orderId, i, totals[idx], idx))
  const retry = await sb.from('order_line_items').insert(legacy)
  return { error: retry.error, degraded: true }
}

export const LINE_EXTRAS_MIGRATION = 'add_tg_jewellers_2.sql'

const eventRow = (r: Record<string, unknown>): OrderEvent => ({ id: r.id as string, orderId: r.order_id as string, type: r.type as string, actor: (r.actor as string) ?? null, payload: (r.payload as Record<string, unknown>) ?? null, createdAt: r.created_at as string })

export async function listOrders(): Promise<Order[]> {
  const c = await ctx(); if (!c) return []
  const sb = await createClient()
  const { data } = await sb.from('orders').select('*').eq('tenant_id', c.tenantId).order('created_at', { ascending: false })
  return ((data as Array<Record<string, unknown>> | null) ?? []).map(orderRow)
}

/**
 * Orders whose LINES match a search term — product name, description, custom spec, SKU, stone type
 * or metal — for the list's search box. Tenant-scoped through the cookie client.
 */
export async function orderIdsMatchingLines(term: string): Promise<Set<string>> {
  const c = await ctx(); if (!c) return new Set()
  const safe = term.replace(/[%,()\\]/g, ' ').trim()
  if (!safe) return new Set()
  const sb = await createClient()
  const like = `%${safe}%`
  const { data } = await sb.from('order_line_items').select('order_id').eq('tenant_id', c.tenantId)
    .or(`product_name.ilike.${like},description.ilike.${like},custom_spec.ilike.${like},sku.ilike.${like},stone_type.ilike.${like},metal_karat.ilike.${like}`)
    .limit(500)
  return new Set(((data as Array<{ order_id: string }> | null) ?? []).map((r) => r.order_id))
}

/**
 * Read an order for a tenant given EXPLICITLY, with no session involved.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────────────────────────────
 *
 * getOrder() below resolves tenancy from ctx() — the signed-in workspace — and reads with the
 * cookie-scoped client. That is right for every owner-facing screen and WRONG for a public one: on
 * /e/[token] there is no session, so ctx() returns null, getOrder() returns null, and the page 404s on
 * a link the customer was just emailed. It did exactly that in production.
 *
 * Here tenancy is an ARGUMENT. The caller has already proved it — the share token resolved to a row
 * carrying tenant_id — so the scope is explicit rather than ambient, and the admin client is correct
 * because there is no user whose RLS could apply. The same shape getApprovalByToken already uses.
 *
 * The tenant_id filter is NOT optional decoration: it is the only thing standing between a leaked
 * order id and another tenant's data, since the admin client bypasses RLS.
 */
export async function getOrderForTenant(tenantId: string, id: string): Promise<OrderWithDetails | null> {
  const sb = createAdminClient()
  const { data } = await sb.from('orders').select('*').eq('tenant_id', tenantId).eq('id', id).maybeSingle()
  if (!data) return null
  const [items, events] = await Promise.all([
    sb.from('order_line_items').select('*').eq('order_id', id).order('display_order'),
    sb.from('order_events').select('*').eq('order_id', id).order('created_at', { ascending: false }),
  ])
  return { ...orderRow(data as Record<string, unknown>), lineItems: ((items.data as Array<Record<string, unknown>>) ?? []).map(lineRow), events: ((events.data as Array<Record<string, unknown>>) ?? []).map(eventRow) }
}

/** The owner-facing read: tenancy from the signed-in workspace. Never use on a public route. */
export async function getOrder(id: string): Promise<OrderWithDetails | null> {
  const c = await ctx(); if (!c) return null
  return getOrderForTenant(c.tenantId, id)
}

const lineTotals = (items: LineItemInput[]) => items.map((i) => Math.round((i.quantity ?? 1) * (i.unitPriceCents ?? 0)))

export async function addEvent(orderId: string, type: string, payload: Record<string, unknown> | null, actor?: string): Promise<void> {
  const c = await ctx(); if (!c) return
  const sb = await createClient()
  // The timeline is the audit trail. A refused insert must not vanish: it is logged with the event
  // it failed to record, so a gap in a history can be traced rather than wondered about.
  const { error } = await sb.from('order_events').insert({ tenant_id: c.tenantId, order_id: orderId, type, actor: actor ?? c.actor, payload })
  if (error) console.error('[orders] timeline row not written', { orderId, type, error: error.message })
}

export async function createOrder(input: OrderInput): Promise<Order | null> {
  const c = await ctx(); if (!c) return null
  const sb = await createClient()
  const items = input.lineItems ?? []
  const totals = lineTotals(items)
  const subtotal = totals.reduce((s, n) => s + n, 0)
  const deposit = input.depositCents ?? 0
  const orderNumber = (input.orderNumber && input.orderNumber.trim()) || generateOrderNumber()
  // The customer record this order belongs to — picked, recognised, or created from what was typed.
  // See lib/orders/link-contact.ts. Failing to link never fails the order.
  const linked = await resolveContactForOrder(sb, c.tenantId, input).catch(() => ({ contactId: input.contactId ?? null, created: false, matched: false }))
  const base = {
    tenant_id: c.tenantId, order_number: orderNumber, contact_id: linked.contactId,
    customer_name: input.customerName ?? null, customer_email: input.customerEmail ?? null, customer_phone: input.customerPhone ?? null,
    stage: 'new', factory_name: input.factoryName ?? null, factory_contact_name: input.factoryContactName ?? null, factory_email: input.factoryEmail ?? null,
    assigned_employee: input.assignedEmployee ?? null, order_date: input.orderDate ?? null, requested_completion_date: input.requestedCompletionDate ?? null, estimated_completion_date: input.estimatedCompletionDate ?? null,
    subtotal_cents: subtotal, deposit_cents: deposit, balance_cents: subtotal - deposit, currency: input.currency ?? 'usd',
    client_requirements: input.clientRequirements ?? null, is_custom_design: input.isCustomDesign ?? false,
    internal_notes: input.internalNotes ?? null, public_notes: input.publicNotes ?? null, created_by: c.actor,
    // The tax choice is accepted by the shared schema on create AND edit; it was applied only on
    // edit, so a create that named one silently lost it — the exact drift the shared schema exists
    // to prevent. Same resolver as updateOrder: the server reads the rate off the id.
    ...(taxSnapshotFrom(input) ?? {}),
    ...('pstExempt' in input ? { pst_exempt: input.pstExempt } : {}),
    ...('pstExemptionNote' in input ? { pst_exemption_note: input.pstExemptionNote ?? null } : {}),
  }
  // Same rule as the line items below: the ORDER is the thing being written and must land. A business
  // name that could not be stored is reported afterwards, by name, rather than taking the order with it.
  // The kind, dropped with a retry when the database has not been told about it: an unmigrated
  // database keeps taking orders (they are all 'custom' there anyway).
  const kindCols = { order_kind: input.orderKind ?? 'custom', kind_details: input.kindDetails ?? {} }
  let { data, error } = await sb.from('orders').insert({ ...base, customer_company: input.customerCompany ?? null, ...kindCols }).select('*').single()
  if (isMissingColumn(error, 'order_kind', 'kind_details')) {
    ;({ data, error } = await sb.from('orders').insert({ ...base, customer_company: input.customerCompany ?? null }).select('*').single())
  }
  let companyDropped = false
  if (isMissingColumn(error, 'customer_company')) {
    companyDropped = !!input.customerCompany
    ;({ data, error } = await sb.from('orders').insert(base).select('*').single())
  }
  if (error) throw new Error(error.code === '23505' ? 'That order number is already in use. Choose a different one.' : error.message)
  const order = orderRow(data as Record<string, unknown>)
  if (items.length) {
    const { error: lineErr, degraded } = await insertLines(sb, c.tenantId, order.id, items, totals)
    // An order that saved and lost its items is worse than one that did not save: the person is told
    // it worked and finds out later. Said out loud, on the same call.
    if (lineErr) throw new Error(`The order was created but its items could not be saved: ${lineErr.message}`)
    if (degraded) throw new Error(`The order was created, but side shapes and band width were not saved — run ${LINE_EXTRAS_MIGRATION} in the Supabase SQL editor.`)
  }
  if (companyDropped) throw new Error(`The order was created, but the business name was not saved — run ${LINE_EXTRAS_MIGRATION} in the Supabase SQL editor.`)
  await addEvent(order.id, 'created', { orderNumber })
  if (linked.contactId && !input.contactId) await addEvent(order.id, 'contact_linked', { contactId: linked.contactId, created: linked.created })
  return order
}

/**
 * Turn the picked choice into the columns the document reads.
 *
 * ONE place, so create and edit cannot store it differently. The choice carries the province too, so
 * picking "ON · HST 13%" sets the place of supply as well — there is no way to end up with a rate
 * from one province and a destination from another, which was possible while they were two controls.
 *
 * An explicit empty string means "No tax": province and snapshot both cleared, and the document prints
 * no tax line — the same as never having chosen, because a 0% line is a claim that no tax is due.
 */
function taxSnapshotFrom(patch: OrderInput): Record<string, unknown> | null {
  if (!('taxChoiceId' in patch)) return null
  const picked = taxChoiceById(patch.taxChoiceId ?? null)
  if (!picked) return { delivery_province: null, tax_kind: null, tax_label: null, tax_rate_percent: null }
  return {
    delivery_province: picked.region,
    tax_kind: picked.kind,
    tax_label: picked.label,
    tax_rate_percent: picked.ratePercent,
  }
}

export async function updateOrder(id: string, patch: OrderInput): Promise<Order | null> {
  const c = await ctx(); if (!c) return null
  const sb = await createClient()
  const m: Record<string, unknown> = { updated_at: new Date().toISOString() }
  const map: Record<string, string> = { orderNumber: 'order_number', contactId: 'contact_id', customerName: 'customer_name', customerCompany: 'customer_company', customerEmail: 'customer_email', customerPhone: 'customer_phone', factoryName: 'factory_name', factoryContactName: 'factory_contact_name', factoryEmail: 'factory_email', assignedEmployee: 'assigned_employee', orderDate: 'order_date', requestedCompletionDate: 'requested_completion_date', estimatedCompletionDate: 'estimated_completion_date', depositCents: 'deposit_cents', currency: 'currency', clientRequirements: 'client_requirements', isCustomDesign: 'is_custom_design', internalNotes: 'internal_notes', publicNotes: 'public_notes', deliveryProvince: 'delivery_province', documentTemplateId: 'document_template_id', invoiceImageId: 'invoice_image_id', letterheadStyle: 'letterhead_style' }
  // Only keys actually PRESENT in the patch are written. That is what lets add_orders_6's columns be
  // optional: a form that does not send delivery_province never names it, so a database without the
  // column is never asked about it.
  for (const [k, col] of Object.entries(map)) if (k in patch) m[col] = (patch as Record<string, unknown>)[k]
  // An edit that names a customer without picking one links it the same way creation does — the
  // edit drawer sends contactId: null for a typed-in walk-in, and that null used to unlink an order
  // that had been recognised. Only when the patch carries customer fields; a tax-only patch leaves
  // the link alone.
  let linkedNow: { contactId: string; created: boolean; manual?: boolean } | null = null
  let unlinkedNow: string | null = null
  const { data: before } = await sb.from('orders').select('contact_id, deposit_cents').eq('tenant_id', c.tenantId).eq('id', id).maybeSingle()
  const priorContact = (before?.contact_id as string) ?? null
  if ('contactId' in patch && !patch.contactId && ('customerEmail' in patch || 'customerPhone' in patch || 'customerName' in patch)) {
    const linked = await resolveContactForOrder(sb, c.tenantId, patch).catch(() => null)
    if (linked?.contactId) { m.contact_id = linked.contactId; if (linked.contactId !== priorContact) linkedNow = { contactId: linked.contactId, created: linked.created } }
  } else if ('contactId' in patch && patch.contactId && patch.contactId !== priorContact) {
    // A person chose the customer (the order page's Link customer, or the picker on the form): on the
    // timeline as a manual link, distinct from the automatic one above.
    linkedNow = { contactId: patch.contactId, created: false, manual: true }
  } else if ('contactId' in patch && !patch.contactId && priorContact) {
    // An explicit unlink: contactId null with NO customer fields in the patch. (A patch that carries
    // customer fields with a null id is the form saying "typed, not picked", handled above.)
    unlinkedNow = priorContact
  }
  // The snapshot, resolved from the picked id rather than from anything the client sent. Written after
  // the field map so it wins over a delivery_province the same patch might also carry.
  const snap = taxSnapshotFrom(patch)
  if (snap) Object.assign(m, snap)
  if ('pstExempt' in patch) m.pst_exempt = patch.pstExempt
  if ('pstExemptionNote' in patch) m.pst_exemption_note = patch.pstExemptionNote
  if ('orderKind' in patch && patch.orderKind) m.order_kind = patch.orderKind
  if ('kindDetails' in patch) m.kind_details = patch.kindDetails ?? {}
  // Never blank out the (NOT NULL, unique) order number — ignore an empty edit.
  if (typeof m.order_number === 'string') { const t = m.order_number.trim(); if (t) m.order_number = t; else delete m.order_number }
  // Re-price if line items are replaced.
  let previousLines: Array<Record<string, unknown>> = []
  let linesReplaced = false
  let degradedNote: string | null = null
  if (patch.lineItems) {
    const totals = lineTotals(patch.lineItems); const subtotal = totals.reduce((s, n) => s + n, 0)
    // ── THE DEPOSIT IS NOT IN THIS PATCH, AND IT USED TO BE TREATED AS ZERO ───────────────────────
    //
    // `patch.depositCents ?? 0`: a client that re-sent the line items without the deposit — which is
    // every client now that money is recorded on the payments ledger rather than typed here — had
    // the order's balance recomputed as if nothing had been paid. The deposit column itself was
    // untouched, so the page showed a deposit AND a balance that ignored it. The current figure is
    // read and kept unless the patch actually names a new one.
    const deposit = 'depositCents' in patch && patch.depositCents !== undefined ? patch.depositCents : Number(before?.deposit_cents ?? 0)
    m.subtotal_cents = subtotal; m.balance_cents = subtotal - deposit
    // ── DELETE THEN INSERT, WITH A WAY BACK ───────────────────────────────────────────────────────
    //
    // Replacing the set means removing it first, and the insert's error used to be discarded — so a
    // refused insert left the order with NO items, updated the subtotal to match, and returned 200.
    // A jeweller hit exactly that and re-entered the same bracelet three times, each attempt wiping
    // the last, with nothing on screen either time. The client was sending an empty array (see
    // namelessError in line-item-fields), but the shape of this write is what turned a bad request
    // into data loss, and that is worth fixing whatever sends it.
    //
    // No transaction is available through PostgREST, so the snapshot IS the transaction: if the
    // insert is refused the old rows go back, ids and all, and the caller is told.
    const { data: previous } = await sb.from('order_line_items').select('*').eq('order_id', id)
    previousLines = (previous as Array<Record<string, unknown>> | null) ?? []
    await sb.from('order_line_items').delete().eq('order_id', id)
    if (patch.lineItems.length) {
      const { error: lineErr, degraded } = await insertLines(sb, c.tenantId, id, patch.lineItems, totals)
      if (lineErr) {
        if (previousLines.length) await sb.from('order_line_items').insert(previousLines)
        throw new Error(`The items could not be saved: ${lineErr.message}. The order is unchanged.`)
      }
      linesReplaced = true
      if (degraded) degradedNote = `The items saved, but side shapes and band width were not — run ${LINE_EXTRAS_MIGRATION} in the Supabase SQL editor.`
    } else {
      linesReplaced = true
    }
  }
  // ── THE ORDER ROW, AND THE WAY BACK IF IT REFUSES ──────────────────────────────────────────────
  //
  // The lines are already replaced when this runs (they had to be, to know the subtotal). If THIS
  // write is refused — a duplicate order number, a column the database has not been told about
  // that the retries below do not recognise — the order would keep its old subtotal above a new
  // set of lines. So a refused order write puts the previous lines back, ids and all, exactly as a
  // refused line insert does: the caller is told, and the order is as it was.
  const restoreLines = async () => {
    if (!linesReplaced) return
    await sb.from('order_line_items').delete().eq('order_id', id)
    if (previousLines.length) await sb.from('order_line_items').insert(previousLines)
  }
  let { data, error } = await sb.from('orders').update(m).eq('tenant_id', c.tenantId).eq('id', id).select('*').single()
  if (isMissingColumn(error, 'order_kind', 'kind_details')) {
    const rest = { ...m }; delete rest.order_kind; delete rest.kind_details
    ;({ data, error } = await sb.from('orders').update(rest).eq('tenant_id', c.tenantId).eq('id', id).select('*').single())
  }
  let companyDropped = false
  if (isMissingColumn(error, 'customer_company')) {
    // Only the ONE key is dropped; every other edit in the patch still applies. The field map above
    // writes a key only when the patch carries it, so this branch is reachable only when she actually
    // typed a business name.
    companyDropped = true
    const rest = { ...m }
    delete rest.customer_company
    ;({ data, error } = await sb.from('orders').update(rest).eq('tenant_id', c.tenantId).eq('id', id).select('*').single())
  }
  if (error) {
    await restoreLines()
    throw new Error(error.code === '23505' ? 'That order number is already in use. Choose a different one.' : error.message)
  }
  if (companyDropped) throw new Error(`The order was saved, but the business name was not — run ${LINE_EXTRAS_MIGRATION} in the Supabase SQL editor.`)
  // Said AFTER the order row is written: the items and the order both saved, and only the two new
  // columns were dropped. Before, this threw before the order row was touched — so the lines were
  // replaced and the subtotal never followed.
  if (degradedNote) throw new Error(degradedNote)
  await addEvent(id, 'updated', null)
  if (linkedNow) await addEvent(id, 'contact_linked', linkedNow)
  if (unlinkedNow) await addEvent(id, 'contact_unlinked', { contactId: unlinkedNow })
  return orderRow(data as Record<string, unknown>)
}

// Manual stage change (drag / explicit set) — approval stages are rejected here; use the workflow actions.
/** Which file teaches the database a stage. Only the ones added after the original CHECK are here. */
const STAGE_MIGRATION: Partial<Record<OrderStage, string>> = {
  finished: 'add_order_finished_stage.sql',
  // BOTH NOW POINT AT THE SAME FILE, and that is the fix for "Close and No sale do not work".
  //
  // Nothing was wrong with the code: `closed_no_sale` shipped complete in db120a6 and its migration
  // was never run, so every attempt hit the CHECK constraint with 23514 and the owner got an error
  // naming a file. add_order_closed_no_sale_stage.sql is folded into add_tg_jewellers_2.sql — which
  // also teaches the database 'pending' — so there is ONE file to run rather than a queue of them,
  // and naming the superseded file would send her to a migration that is not the one to run.
  closed_no_sale: 'add_tg_jewellers_2.sql',
  pending: 'add_tg_jewellers_2.sql',
  in_process: 'add_tg_production_1.sql',
}

/**
 * Move an order between stages by hand — the board drop, the stage buttons, and Reopen all land here.
 *
 * `note` is the optional reason ("customer changed the stone", "reopened — wants matching band") and
 * is written to the timeline row with from, to and who. Every surface that shows history reads that
 * row, so a move is never a silent change of one column.
 */
export async function setStageManual(id: string, to: OrderStage, note?: string | null): Promise<{ ok: boolean; error?: string }> {
  const c = await ctx(); if (!c) return { ok: false, error: 'unauthorized' }
  const sb = await createClient()
  const { data } = await sb.from('orders').select('stage').eq('tenant_id', c.tenantId).eq('id', id).maybeSingle()
  if (!data) return { ok: false, error: 'not found' }
  const from = data.stage as OrderStage
  if (!canManualTransition(from, to)) return { ok: false, error: `This order cannot move from ${STAGE_LABELS[from]} to ${STAGE_LABELS[to]}.` }
  // A stage the database has not been taught yet is refused HERE, in words a person can act on,
  // rather than by the CHECK constraint with a code. The migration is named in the server log only.
  if (!stageSupported(await getSchemaCapabilities(), to)) {
    console.warn(`[orders] stage ${to} not available: ${STAGE_MIGRATION[to] ?? 'migration'} not applied`)
    return { ok: false, error: `"${STAGE_LABELS[to]}" is not available on this account yet.` }
  }
  // THE WRITE'S ERROR WAS BEING DISCARDED. It returned ok on a refused update, the screen refreshed,
  // and the stage was simply unchanged — a silent failure with nothing to read. It matters now because
  // 'finished' is a stage the DATABASE has to be told about: against an unmigrated constraint the write
  // fails with 23514 and the owner would have seen a button that did nothing.
  const { error } = await sb.from('orders').update({ stage: to, updated_at: new Date().toISOString() })
    .eq('tenant_id', c.tenantId).eq('id', id)
  if (error) {
    return {
      ok: false,
      // Naming the RIGHT file. This said add_order_finished_stage.sql for every stage, which was
      // true when 'finished' was the only one the database had to be told about and became wrong the
      // moment a second one arrived — sending the owner to a migration that is already run.
      error: error.code === '23514'
        ? (console.warn(`[orders] stage ${to} refused by CHECK: ${STAGE_MIGRATION[to] ?? 'migration'} not applied`), `"${STAGE_LABELS[to]}" is not available on this account yet.`)
        : error.message,
    }
  }
  const reason = (note ?? '').trim() || null
  await addEvent(id, 'stage_changed', { from, to, manual: true, ...(reason ? { note: reason } : {}) })
  return { ok: true }
}

// ── DELETION IS FOR MISTAKES, NOT FOR ENDINGS ───────────────────────────────────────────────────
//
// The product has three ways to END an order (finished, cancelled, no-sale) and all of them keep
// everything. Delete is for a record that should never have existed — a duplicate created by a
// double-tap, a test. So it is refused the moment the order has become a fact to somebody else:
// a document or approval link was sent, a payment was recorded, or the job left 'new'. Those orders
// are closed, not deleted, because a customer holding an estimate for a record that has vanished
// is exactly the data loss the no-sale stage exists to prevent.
//
// Enforced HERE, on the server, and not only by hiding the button.
export interface DeletableVerdict { ok: boolean; reason?: string }
export async function deletable(id: string): Promise<DeletableVerdict> {
  const c = await ctx(); if (!c) return { ok: false, reason: 'unauthorized' }
  const sb = await createClient()
  const { data: order } = await sb.from('orders').select('stage').eq('tenant_id', c.tenantId).eq('id', id).maybeSingle()
  if (!order) return { ok: false, reason: 'not found' }
  if (order.stage !== 'new') return { ok: false, reason: `This order has moved past New — close it instead of deleting it, so its history stays with the customer.` }
  const admin = createAdminClient()
  const [shares, approvals, payments] = await Promise.all([
    admin.from('order_document_shares').select('id', { count: 'exact', head: true }).eq('tenant_id', c.tenantId).eq('order_id', id),
    admin.from('order_approval_requests').select('id', { count: 'exact', head: true }).eq('tenant_id', c.tenantId).eq('order_id', id),
    admin.from('payment_allocations').select('id', { count: 'exact', head: true }).eq('tenant_id', c.tenantId).eq('document_type', 'order').eq('document_id', id),
  ])
  if (shares.count) return { ok: false, reason: 'A document link for this order has been sent. Close it as no sale instead — the customer may still open what they were sent.' }
  if (approvals.count) return { ok: false, reason: 'An approval request for this order has been sent. Cancel or close it instead.' }
  if (payments.count) return { ok: false, reason: 'A payment has been recorded against this order. It cannot be deleted; cancel it and refund instead.' }
  return { ok: true }
}

// Permanently delete an order. Removes its private storage files first (not FK-cascaded), then deletes the
// order row — line items, events, attachments rows, and approval requests are removed by ON DELETE CASCADE.
export async function deleteOrder(id: string): Promise<boolean> {
  const c = await ctx(); if (!c) return false
  if (!(await deletable(id)).ok) return false
  const sb = await createClient()
  const { data: order } = await sb.from('orders').select('id').eq('tenant_id', c.tenantId).eq('id', id).maybeSingle()
  if (!order) return false
  const { data: atts } = await sb.from('order_attachments').select('storage_path').eq('tenant_id', c.tenantId).eq('order_id', id)
  const paths = ((atts as Array<Record<string, unknown>> | null) ?? []).map((a) => a.storage_path as string).filter(Boolean)
  if (paths.length) await createAdminClient().storage.from(ORDER_BUCKET).remove(paths)
  const { error } = await sb.from('orders').delete().eq('tenant_id', c.tenantId).eq('id', id)
  return !error
}
