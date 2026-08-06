import { createHash } from 'crypto'
import { createAdminClient } from '@/lib/supabase/server'
import { requireActiveBusinessContext, getActiveTenantId } from '@/lib/workspace'
import { enabledModulesOf } from '@/lib/modules'
import { getCostSettings } from '@/lib/catalog/costs'
import { allocate, coverage, type Charges } from './allocate'
import { matchInvoiceLines, suggestProducts } from './match'
import { extractInvoice, extendedOf } from './extract'
import {
  EXTRACTABLE_EXTENSIONS, MAX_INVOICE_BYTES, MIN_COVERAGE, extensionOf, invoiceFileError,
  type DuplicateWarning, type InvoiceLine, type ShipmentDetail, type Shipment, type SupplierInvoice,
} from './types'

// Supplier invoices → shipments → landed cost, server side.
//
// The bucket is private and files are reached only through short-lived signed URLs generated here — the
// same shape as order-attachments, and a SEPARATE bucket because that one's paths and access reasoning
// are built around an order a supplier invoice does not have.

export const INVOICE_BUCKET = 'supplier-invoices'

export type Result<T> = { ok: true; data: T } | { ok: false; reason: 'not_found' | 'forbidden'; error?: string }

/**
 * The single gate. Three things must hold before a row is read: a resolvable active workspace, the
 * `landed_cost` module on for it, and a session allowed to see costs.
 *
 * canViewCosts is the one that matters most here — a supplier invoice IS the business's cost structure,
 * line by line, and a White Label operator inside a client workspace must never see it. Refused before
 * anything is read, not hidden afterwards.
 */
async function gate(): Promise<{ tenantId: string; actorUserId: string } | 'not_found' | 'forbidden'> {
  const tenantId = await getActiveTenantId()
  if (!tenantId) return 'not_found'

  const { data } = await createAdminClient().from('tenants').select('id, enabled_modules').eq('id', tenantId).maybeSingle()
  if (!data || !enabledModulesOf(data).includes('landed_cost')) return 'not_found'

  const c = await requireActiveBusinessContext()
  if (!c) return 'not_found'
  if (!c.capabilities.canViewCosts) return 'forbidden'
  return { tenantId, actorUserId: c.actorUserId }
}

const shipmentRow = (r: Record<string, unknown>): Shipment => ({
  id: r.id as string,
  reference: (r.reference as string) ?? null,
  currency: (r.currency as string) || 'USD',
  freightTotal: Number(r.freight_total ?? 0),
  dutiesTotal: Number(r.duties_total ?? 0),
  otherTotal: Number(r.other_total ?? 0),
  status: r.status as Shipment['status'],
  appliedAt: (r.applied_at as string) ?? null,
  createdAt: r.created_at as string,
})

const invoiceRow = (r: Record<string, unknown>): SupplierInvoice => ({
  id: r.id as string,
  shipmentId: r.shipment_id as string,
  supplierName: (r.supplier_name as string) ?? null,
  invoiceNumber: (r.invoice_number as string) ?? null,
  invoiceDate: (r.invoice_date as string) ?? null,
  currency: (r.currency as string) || 'USD',
  subtotal: r.subtotal === null || r.subtotal === undefined ? null : Number(r.subtotal),
  taxTotal: r.tax_total === null || r.tax_total === undefined ? null : Number(r.tax_total),
  grandTotal: r.grand_total === null || r.grand_total === undefined ? null : Number(r.grand_total),
  fileName: r.file_name as string,
  fileSize: Number(r.file_size ?? 0),
  pageCount: r.page_count === null || r.page_count === undefined ? null : Number(r.page_count),
  status: r.status as SupplierInvoice['status'],
  extractionError: (r.extraction_error as string) ?? null,
  extractionCostUsd: r.extraction_cost_usd === null || r.extraction_cost_usd === undefined ? null : Number(r.extraction_cost_usd),
  createdAt: r.created_at as string,
})

const lineRow = (r: Record<string, unknown>): InvoiceLine => {
  const product = r.catalog_products as { name?: string; sku?: string } | null | undefined
  return {
    id: r.id as string,
    lineNo: Number(r.line_no ?? 0),
    description: (r.description as string) ?? null,
    sku: (r.sku as string) ?? null,
    quantity: r.quantity === null || r.quantity === undefined ? null : Number(r.quantity),
    unitPrice: r.unit_price === null || r.unit_price === undefined ? null : Number(r.unit_price),
    extended: Number(r.extended ?? 0),
    productId: (r.product_id as string) ?? null,
    productName: product?.name ?? null,
    productSku: product?.sku ?? null,
    matchMethod: (r.match_method as InvoiceLine['matchMethod']) ?? null,
    matchConfidence: r.match_confidence === null || r.match_confidence === undefined ? null : Number(r.match_confidence),
    status: r.status as InvoiceLine['status'],
    allocatedFreight: Number(r.allocated_freight ?? 0),
    allocatedDuties: Number(r.allocated_duties ?? 0),
  }
}

/**
 * Has this invoice been here before?
 *
 * Two questions, in order of certainty: the same bytes, then the same supplier and invoice number.
 * Neither BLOCKS — re-uploading after a failed extraction is legitimate and common. The answer is shown
 * with a link to what was found, because "you already have this, here it is" is a more useful response
 * than a refusal, and the owner is the one who knows which of the two they meant.
 *
 * Nothing is written until they choose, so an accidental duplicate costs an upload, not a catalogue.
 */
export async function findDuplicate(tenantId: string, fileHash: string, supplier: string | null, number: string | null): Promise<DuplicateWarning | null> {
  const db = createAdminClient()
  const select = 'id, shipment_id, supplier_name, invoice_number, created_at, landed_cost_shipments!inner(status, applied_at)'

  const { data: sameFile } = await db.from('supplier_invoices')
    .select(select).eq('tenant_id', tenantId).eq('file_hash', fileHash)
    .order('created_at', { ascending: false }).limit(1).maybeSingle()

  const found = sameFile
    ?? (supplier && number
      ? (await db.from('supplier_invoices')
          .select(select).eq('tenant_id', tenantId)
          .ilike('supplier_name', supplier).ilike('invoice_number', number)
          .order('created_at', { ascending: false }).limit(1).maybeSingle()).data
      : null)

  if (!found) return null
  const r = found as Record<string, unknown>
  const ship = r.landed_cost_shipments as { status: string; applied_at: string | null }
  return {
    shipmentId: r.shipment_id as string,
    invoiceId: r.id as string,
    reason: sameFile ? 'same_file' : 'same_invoice_number',
    supplierName: (r.supplier_name as string) ?? null,
    invoiceNumber: (r.invoice_number as string) ?? null,
    status: ship.status as Shipment['status'],
    appliedAt: ship.applied_at,
    createdAt: r.created_at as string,
  }
}

/**
 * Upload a file, read it, match it, allocate it — everything up to but NOT including writing a cost.
 *
 * The whole point of stopping here is that the owner sees the result before it touches a product. On
 * return the shipment is in 'review' and one action away from being applied, or in 'failed' with a
 * reason they can act on.
 */
export async function createShipmentFromFile(file: File): Promise<Result<{ shipmentId: string; duplicate: DuplicateWarning | null }>> {
  const g = await gate()
  if (g === 'not_found' || g === 'forbidden') return { ok: false, reason: g }

  const problem = invoiceFileError(file.name, file.size)
  if (problem) return { ok: false, reason: 'not_found', error: problem }

  const ext = extensionOf(file.name)
  const mimeType = EXTRACTABLE_EXTENSIONS[ext]
  const bytes = Buffer.from(await file.arrayBuffer())
  const fileHash = createHash('sha256').update(bytes).digest('hex')

  const db = createAdminClient()
  const settings = await getCostSettings(g.tenantId)

  // Shipment and invoice rows first, so a failure during extraction leaves something on screen with a
  // reason on it rather than a file in a bucket nobody can see.
  const { data: shipment, error: se } = await db.from('landed_cost_shipments')
    .insert({ tenant_id: g.tenantId, currency: settings.baseCurrency, status: 'extracting', created_by: g.actorUserId })
    .select('*').single()
  if (se) return { ok: false, reason: 'not_found', error: se.message }

  const shipmentId = (shipment as Record<string, unknown>).id as string
  const storagePath = `${g.tenantId}/${shipmentId}/${crypto.randomUUID()}.${ext}`

  // Stored under OUR content type, never the browser's claim — the uploader does not get to decide how
  // the file is served back.
  const up = await db.storage.from(INVOICE_BUCKET).upload(storagePath, bytes, { contentType: mimeType, upsert: false })
  if (up.error) {
    await db.from('landed_cost_shipments').delete().eq('id', shipmentId)
    return { ok: false, reason: 'not_found', error: up.error.message }
  }

  const { data: invoice, error: ie } = await db.from('supplier_invoices').insert({
    tenant_id: g.tenantId, shipment_id: shipmentId,
    currency: settings.baseCurrency, storage_path: storagePath,
    file_name: file.name.slice(0, 200), mime_type: mimeType, file_size: file.size,
    file_hash: fileHash, status: 'extracting', created_by: g.actorUserId,
  }).select('*').single()
  if (ie) {
    await db.storage.from(INVOICE_BUCKET).remove([storagePath])
    await db.from('landed_cost_shipments').delete().eq('id', shipmentId)
    return { ok: false, reason: 'not_found', error: ie.message }
  }

  const invoiceId = (invoice as Record<string, unknown>).id as string

  try {
    const ex = await extractInvoice(g.tenantId, bytes, mimeType, settings.baseCurrency)
    const inv = ex.invoice

    await db.from('supplier_invoices').update({
      supplier_name: inv.supplierName, invoice_number: inv.invoiceNumber,
      invoice_date: isoDate(inv.invoiceDate), currency: inv.currency || settings.baseCurrency,
      subtotal: inv.subtotal, tax_total: inv.taxTotal, grand_total: inv.grandTotal,
      page_count: ex.pageCount, status: 'extracted', extraction_error: null,
      extraction_model: ex.model, extraction_input_tokens: ex.inputTokens,
      extraction_output_tokens: ex.outputTokens, extraction_completion_id: ex.completionId,
      updated_at: new Date().toISOString(),
    }).eq('id', invoiceId)

    await db.from('landed_cost_shipments').update({
      reference: [inv.supplierName, inv.invoiceNumber].filter(Boolean).join(' ') || null,
      currency: inv.currency || settings.baseCurrency,
      freight_total: inv.freightTotal ?? 0,
      duties_total: inv.dutiesTotal ?? 0,
      other_total: inv.otherTotal ?? 0,
      status: 'review', updated_at: new Date().toISOString(),
    }).eq('id', shipmentId)

    const rows = inv.lines.map((l, i) => ({
      tenant_id: g.tenantId, invoice_id: invoiceId, line_no: i + 1,
      description: l.description, sku: l.sku, quantity: l.quantity, unit_price: l.unitPrice,
      extended: extendedOf(l), status: 'unmatched' as const,
    }))
    if (rows.length) await db.from('supplier_invoice_lines').insert(rows)

    await rematch(g.tenantId, invoiceId)
    await reallocate(g.tenantId, shipmentId)

    const duplicate = await findDuplicate(g.tenantId, fileHash, inv.supplierName, inv.invoiceNumber)
    return { ok: true, data: { shipmentId, duplicate: duplicate?.invoiceId === invoiceId ? null : duplicate } }
  } catch (e) {
    const message = (e as Error).message
    await db.from('supplier_invoices').update({ status: 'failed', extraction_error: message }).eq('id', invoiceId)
    await db.from('landed_cost_shipments').update({ status: 'failed' }).eq('id', shipmentId)
    // Not a Result failure: the shipment EXISTS and carries the reason, which is what the owner needs
    // to see. Returning 'not_found' here would hide a row that is sitting in their list.
    return { ok: true, data: { shipmentId, duplicate: null } }
  }
}

/** ISO date or nothing — a malformed date must not fail the whole extraction. */
const isoDate = (s: string | null): string | null => {
  if (!s) return null
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10)
}

/** Run the deterministic matcher over every line that the owner has not decided by hand. */
export async function rematch(tenantId: string, invoiceId: string): Promise<void> {
  const db = createAdminClient()
  const { data } = await db.from('supplier_invoice_lines')
    .select('id, sku, description, status, match_method')
    .eq('tenant_id', tenantId).eq('invoice_id', invoiceId)

  const lines = ((data as Array<Record<string, unknown>> | null) ?? [])
    // A manual match and a deliberate skip are the owner's decisions; re-running the ladder over them
    // would quietly undo the work they did on the screen in front of them.
    .filter((l) => l.match_method !== 'manual' && l.status !== 'skipped')
    .map((l) => ({ id: l.id as string, sku: (l.sku as string) ?? null, description: (l.description as string) ?? null }))

  if (!lines.length) return
  const { matches } = await matchInvoiceLines(tenantId, lines)

  for (const line of lines) {
    const m = matches.get(line.id)
    await db.from('supplier_invoice_lines').update({
      product_id: m?.productId ?? null,
      match_method: m?.method ?? null,
      match_confidence: m?.confidence ?? null,
      status: m ? 'matched' : 'unmatched',
      updated_at: new Date().toISOString(),
    }).eq('id', line.id).eq('tenant_id', tenantId)
  }
}

/**
 * Recompute the whole allocation and store it.
 *
 * Run after ANY change to matching. The allocation is a function of which lines are matched, so a
 * single line changing state moves every other line's share — recomputing one line would leave the rest
 * summing to something other than what was paid, and apply_shipment_costs would then refuse the write.
 */
export async function reallocate(tenantId: string, shipmentId: string): Promise<void> {
  const db = createAdminClient()
  const { data: ship } = await db.from('landed_cost_shipments')
    .select('freight_total, duties_total, other_total').eq('id', shipmentId).eq('tenant_id', tenantId).maybeSingle()
  if (!ship) return

  const { data: inv } = await db.from('supplier_invoices').select('id').eq('shipment_id', shipmentId).eq('tenant_id', tenantId).maybeSingle()
  if (!inv) return

  const { data } = await db.from('supplier_invoice_lines')
    .select('id, extended, status').eq('tenant_id', tenantId).eq('invoice_id', (inv as { id: string }).id).order('line_no')

  const lines = ((data as Array<Record<string, unknown>> | null) ?? [])
    .map((l) => ({ id: l.id as string, extended: Number(l.extended ?? 0), status: l.status as InvoiceLine['status'] }))

  const charges: Charges = {
    freightTotal: Number((ship as Record<string, unknown>).freight_total ?? 0),
    dutiesTotal: Number((ship as Record<string, unknown>).duties_total ?? 0),
    otherTotal: Number((ship as Record<string, unknown>).other_total ?? 0),
  }

  for (const a of allocate(charges, lines)) {
    await db.from('supplier_invoice_lines')
      .update({ allocated_freight: a.allocatedFreight, allocated_duties: a.allocatedDuties, updated_at: new Date().toISOString() })
      .eq('id', a.lineId).eq('tenant_id', tenantId)
  }
}

/** Everything the approval screen needs. */
export async function getShipment(shipmentId: string): Promise<Result<ShipmentDetail>> {
  const g = await gate()
  if (g === 'not_found' || g === 'forbidden') return { ok: false, reason: g }

  const db = createAdminClient()
  const { data: ship } = await db.from('landed_cost_shipments').select('*').eq('id', shipmentId).eq('tenant_id', g.tenantId).maybeSingle()
  if (!ship) return { ok: false, reason: 'not_found' }

  const { data: inv } = await db.from('supplier_invoices').select('*').eq('shipment_id', shipmentId).eq('tenant_id', g.tenantId).maybeSingle()
  if (!inv) return { ok: false, reason: 'not_found' }

  const { data: lines } = await db.from('supplier_invoice_lines')
    .select('*, catalog_products(name, sku)')
    .eq('tenant_id', g.tenantId).eq('invoice_id', (inv as { id: string }).id).order('line_no')

  const settings = await getCostSettings(g.tenantId)
  return {
    ok: true,
    data: {
      shipment: shipmentRow(ship as Record<string, unknown>),
      invoice: invoiceRow(inv as Record<string, unknown>),
      lines: ((lines as Array<Record<string, unknown>> | null) ?? []).map(lineRow),
      settings: { baseCurrency: settings.baseCurrency, secondaryCurrency: settings.secondaryCurrency, markupPercent: settings.markupPercent },
    },
  }
}

export async function listShipments(): Promise<Result<Array<Shipment & { invoice: SupplierInvoice | null }>>> {
  const g = await gate()
  if (g === 'not_found' || g === 'forbidden') return { ok: false, reason: g }

  const db = createAdminClient()
  const { data } = await db.from('landed_cost_shipments')
    .select('*, supplier_invoices(*)').eq('tenant_id', g.tenantId).order('created_at', { ascending: false }).limit(100)

  return {
    ok: true,
    data: ((data as Array<Record<string, unknown>> | null) ?? []).map((r) => {
      const invs = r.supplier_invoices as Array<Record<string, unknown>> | Record<string, unknown> | null
      const one = Array.isArray(invs) ? invs[0] : invs
      return { ...shipmentRow(r), invoice: one ? invoiceRow(one) : null }
    }),
  }
}

/** A signed URL so the owner can read the invoice beside the lines. Short-lived; the bucket stays private. */
export async function invoiceFileUrl(shipmentId: string, expiresIn = 300): Promise<Result<string>> {
  const g = await gate()
  if (g === 'not_found' || g === 'forbidden') return { ok: false, reason: g }

  const db = createAdminClient()
  const { data: inv } = await db.from('supplier_invoices').select('storage_path').eq('shipment_id', shipmentId).eq('tenant_id', g.tenantId).maybeSingle()
  if (!inv) return { ok: false, reason: 'not_found' }

  const { data } = await db.storage.from(INVOICE_BUCKET).createSignedUrl((inv as { storage_path: string }).storage_path, expiresIn)
  return data?.signedUrl ? { ok: true, data: data.signedUrl } : { ok: false, reason: 'not_found' }
}

/** Match, unmatch or skip one line by hand, then re-run the allocation over the whole invoice. */
export async function setLineMatch(lineId: string, productId: string | null, skip: boolean): Promise<Result<ShipmentDetail>> {
  const g = await gate()
  if (g === 'not_found' || g === 'forbidden') return { ok: false, reason: g }

  const db = createAdminClient()
  const { data: line } = await db.from('supplier_invoice_lines')
    .select('id, invoice_id, supplier_invoices!inner(shipment_id)').eq('id', lineId).eq('tenant_id', g.tenantId).maybeSingle()
  if (!line) return { ok: false, reason: 'not_found' }

  await db.from('supplier_invoice_lines').update({
    product_id: skip ? null : productId,
    // 'manual' is recorded so rematch() leaves this alone afterwards, and so the screen can show that a
    // person decided it rather than the ladder.
    match_method: skip || !productId ? null : 'manual',
    match_confidence: null,
    status: skip ? 'skipped' : productId ? 'matched' : 'unmatched',
    updated_at: new Date().toISOString(),
  }).eq('id', lineId).eq('tenant_id', g.tenantId)

  const shipmentId = ((line as Record<string, unknown>).supplier_invoices as { shipment_id: string }).shipment_id
  await reallocate(g.tenantId, shipmentId)
  return getShipment(shipmentId)
}

/**
 * Products the owner might mean for a line the matcher would not place.
 *
 * A shortlist, not a decision: anything chosen from it is recorded as a 'manual' match, because a
 * person picking from a list and the ladder scoring a name are different kinds of fact and the screen
 * shows them differently.
 */
export async function suggestForLine(lineId: string): Promise<Result<Array<{ id: string; name: string; sku: string | null }>>> {
  const g = await gate()
  if (g === 'not_found' || g === 'forbidden') return { ok: false, reason: g }

  const db = createAdminClient()
  const { data: line } = await db.from('supplier_invoice_lines')
    .select('id, sku, description').eq('id', lineId).eq('tenant_id', g.tenantId).maybeSingle()
  if (!line) return { ok: false, reason: 'not_found' }

  const l = line as Record<string, unknown>
  const suggestions = await suggestProducts(g.tenantId, {
    id: l.id as string,
    sku: (l.sku as string) ?? null,
    description: (l.description as string) ?? null,
  })
  return { ok: true, data: suggestions }
}

/** Edit the shipment's charges by hand — a forwarder's bill often arrives apart from the invoice. */
export async function setCharges(shipmentId: string, charges: Partial<Charges> & { reference?: string }): Promise<Result<ShipmentDetail>> {
  const g = await gate()
  if (g === 'not_found' || g === 'forbidden') return { ok: false, reason: g }

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (charges.freightTotal !== undefined) patch.freight_total = Math.max(0, charges.freightTotal)
  if (charges.dutiesTotal !== undefined) patch.duties_total = Math.max(0, charges.dutiesTotal)
  if (charges.otherTotal !== undefined) patch.other_total = Math.max(0, charges.otherTotal)
  if (charges.reference !== undefined) patch.reference = charges.reference.slice(0, 200) || null

  const db = createAdminClient()
  const { error } = await db.from('landed_cost_shipments').update(patch).eq('id', shipmentId).eq('tenant_id', g.tenantId)
  if (error) return { ok: false, reason: 'not_found', error: error.message }

  await reallocate(g.tenantId, shipmentId)
  return getShipment(shipmentId)
}

/**
 * Write the allocation onto the products.
 *
 * One RPC, one transaction — see add_landed_cost_invoices.sql for why this path uses the admin client
 * while every other cost write goes through the RLS-scoped one. Every guard the RPC applies (coverage,
 * allocation totals, tenancy) is re-derived in SQL rather than trusted from here, so a bug in this file
 * can fail the apply but cannot corrupt a cost row.
 */
export async function applyShipment(shipmentId: string, opts: { override?: boolean; reapply?: boolean } = {}): Promise<Result<ShipmentDetail>> {
  const g = await gate()
  if (g === 'not_found' || g === 'forbidden') return { ok: false, reason: g }

  // Recomputed immediately before the write, not just after each edit. Matching can change without this
  // feature knowing: deleting a product un-matches its invoice lines through a database trigger, and a
  // shipment left in review across that would otherwise reach the RPC holding an allocation that no
  // longer covers its charges — and be refused for a reason the owner did not cause and cannot see.
  await reallocate(g.tenantId, shipmentId)

  const { error } = await createAdminClient().rpc('apply_shipment_costs', {
    p_tenant: g.tenantId,
    p_shipment: shipmentId,
    p_actor: g.actorUserId,
    // The owner may overrule the coverage threshold, and that override travels as a number the database
    // enforces rather than as a boolean this file could forget to check.
    p_min_coverage: opts.override ? 0 : MIN_COVERAGE,
    p_reapply: Boolean(opts.reapply),
  })
  if (error) return { ok: false, reason: 'not_found', error: error.message }
  return getShipment(shipmentId)
}

/** Coverage for a set of lines — re-exported so routes and the UI never recompute it differently. */
export { coverage, MIN_COVERAGE, MAX_INVOICE_BYTES }
