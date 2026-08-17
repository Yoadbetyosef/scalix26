import { createHash } from 'crypto'
import { createAdminClient } from '@/lib/supabase/server'
import { requireActiveBusinessContext, getActiveTenantId } from '@/lib/workspace'
import { enabledModulesOf } from '@/lib/modules'
import { getCostSettings } from '@/lib/catalog/costs'
import { allocate, coverage, type Charges } from './allocate'
import { clearsGates, describe as describeDivergence, divergenceSentence, projectCost, type Divergence } from './divergence'
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
 * The apply's extra answer, and ONLY the apply's.
 *
 * 'divergence' is not a failure — it is the write asking to be confirmed, carrying the flagged products
 * so the caller can show what it is asking about rather than a bare refusal. Deliberately NOT folded
 * into Result<T>: widening the shared type made every unrelated route stop compiling, which was the
 * type system pointing out that no other caller can ever receive this.
 */
export type ApplyResult =
  | Result<ShipmentDetail>
  | { ok: false; reason: 'divergence'; error: string; divergences: Divergence[] }

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
  commissionPercent: r.commission_percent === null || r.commission_percent === undefined ? null : Number(r.commission_percent),
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
  matchNote: (r.match_note as string) ?? null,
  exchangeRate: r.exchange_rate === null || r.exchange_rate === undefined ? null : Number(r.exchange_rate),
  extractedFreight: r.extracted_freight === null || r.extracted_freight === undefined ? null : Number(r.extracted_freight),
  extractedDuties: r.extracted_duties === null || r.extracted_duties === undefined ? null : Number(r.extracted_duties),
  extractedOther: r.extracted_other === null || r.extracted_other === undefined ? null : Number(r.extracted_other),
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
      // What the SUPPLIER billed for carriage, in the invoice's currency. Evidence, not a value: it is
      // shown beside the forwarder's figure so the owner can spot the same shipment quoted twice, and
      // it never reaches landed_cost_shipments.freight_total.
      extracted_freight: inv.freightTotal, extracted_duties: inv.dutiesTotal, extracted_other: inv.otherTotal,
      page_count: ex.pageCount, status: 'extracted', extraction_error: null,
      extraction_model: ex.model, extraction_input_tokens: ex.inputTokens,
      extraction_output_tokens: ex.outputTokens, extraction_completion_id: ex.completionId,
      updated_at: new Date().toISOString(),
    }).eq('id', invoiceId)

    await db.from('landed_cost_shipments').update({
      reference: [inv.supplierName, inv.invoiceNumber].filter(Boolean).join(' ') || null,
      // The shipment's currency is the FORWARDER'S, not the invoice's, and the forwarder bills in the
      // tenant's own currency — so it stays base currency and is never seeded from the document.
      //
      // Seeding it from inv.currency is exactly what shipped in phase 1: a EUR invoice stamped the
      // freight field EUR, and apply_shipment_costs then refused a shape the code should never have
      // produced. The guard was right; this line was wrong.
      currency: settings.baseCurrency,
      // Deliberately NOT populated from the invoice. Freight comes from the forwarder's bill, in base
      // currency, typed in by a person reading it. Copying the supplier's figure here would put a EUR
      // number in a USD field the moment the invoice is foreign — and would do it silently, because
      // the currency label above now says the field is USD.
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
    // A manual match, a CREATED product and a deliberate skip are all the owner's decisions; re-running
    // the ladder over them would quietly undo the work they did on the screen in front of them. A
    // 'created' line is the strongest of the three — it points at a product that exists because of it.
    .filter((l) => l.match_method !== 'manual' && l.match_method !== 'created' && l.status !== 'skipped')
    .map((l) => ({ id: l.id as string, sku: (l.sku as string) ?? null, description: (l.description as string) ?? null }))

  if (!lines.length) return
  const { matches, catalogSize, nameMatchingSkipped } = await matchInvoiceLines(tenantId, lines)

  // Recorded whether or not it degraded, so a note left by an earlier run against a bigger catalogue
  // does not outlive the condition that produced it.
  await db.from('supplier_invoices').update({
    match_note: nameMatchingSkipped
      ? `Your catalogue has ${catalogSize.toLocaleString()} products — too many to compare by name, so only SKUs were matched. Lines below without a SKU will need matching by hand.`
      : null,
  }).eq('id', invoiceId).eq('tenant_id', tenantId)

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

/**
 * Mark any line whose product ALREADY carries freight from a different, applied shipment.
 *
 * Applying replaces a product's shipping_cost rather than adding to it. That is right for one shipment
 * and wrong for two: reorder the same sofa next month and the second apply silently erases the first
 * one's freight, leaving the margin on that product wrong from then on with nothing on screen to say
 * so. Phase 2 fixes the modelling. This makes it visible in the meantime.
 *
 * Two queries rather than one two-level embedded filter: each is simple enough to predict, and this
 * runs once per screen load.
 */
async function withPriorShipments(tenantId: string, invoiceId: string, lines: InvoiceLine[]): Promise<InvoiceLine[]> {
  const productIds = [...new Set(lines.filter((l) => l.status === 'matched' && l.productId).map((l) => l.productId!))]
  if (!productIds.length) return lines

  const db = createAdminClient()

  // Applied shipments only — a shipment still in review has written nothing to overwrite.
  const { data: invoices } = await db.from('supplier_invoices')
    .select('id, shipment_id, landed_cost_shipments!inner(reference, applied_at, status)')
    .eq('tenant_id', tenantId).eq('landed_cost_shipments.status', 'applied').neq('id', invoiceId)

  type PriorShip = { id: string; reference: string | null; appliedAt: string | null }
  const shipmentOf = new Map<string, PriorShip>()
  for (const r of (invoices as Array<Record<string, unknown>> | null) ?? []) {
    const s = r.landed_cost_shipments as { reference: string | null; applied_at: string | null }
    shipmentOf.set(r.id as string, { id: r.shipment_id as string, reference: s.reference, appliedAt: s.applied_at })
  }
  if (!shipmentOf.size) return lines

  const { data: prior } = await db.from('supplier_invoice_lines')
    .select('invoice_id, product_id, quantity, allocated_freight, allocated_duties')
    .eq('tenant_id', tenantId).eq('status', 'matched')
    .in('invoice_id', [...shipmentOf.keys()]).in('product_id', productIds)

  // Accumulated per (product, invoice) BEFORE the most-recent comparison, because a product can appear
  // on several lines of one invoice — a split delivery, two colours of one SKU. Comparing line by line
  // would keep whichever line was read first and report a fraction of what that shipment actually put
  // on the product. The quantity matters for the same reason and for one more: the pack-size shape in
  // divergence.ts reads it, and a partial count would invent a pack error that is not there.
  const perInvoice = new Map<string, { pid: string; ship: PriorShip; amount: number; quantity: number }>()
  for (const r of (prior as Array<Record<string, unknown>> | null) ?? []) {
    const ship = shipmentOf.get(r.invoice_id as string)
    if (!ship) continue
    const pid = r.product_id as string
    const key = `${pid}:${r.invoice_id as string}`
    const acc = perInvoice.get(key) ?? { pid, ship, amount: 0, quantity: 0 }
    acc.amount += Number(r.allocated_freight ?? 0) + Number(r.allocated_duties ?? 0)
    acc.quantity += Number(r.quantity ?? 0)
    perInvoice.set(key, acc)
  }

  // Most recent apply wins the mention: that is the freight currently sitting on the product, and so
  // the figure this shipment would actually replace.
  const byProduct = new Map<string, NonNullable<InvoiceLine['priorShipment']>>()
  for (const acc of perInvoice.values()) {
    if (acc.amount <= 0) continue
    const seen = byProduct.get(acc.pid)
    if (!seen || (acc.ship.appliedAt ?? '') > (seen.appliedAt ?? '')) {
      byProduct.set(acc.pid, { ...acc.ship, amount: acc.amount, quantity: acc.quantity || null })
    }
  }

  return lines.map((l) => (l.productId && byProduct.has(l.productId) ? { ...l, priorShipment: byProduct.get(l.productId) } : l))
}

/**
 * Flag every line that shares its product with another line on the SAME invoice.
 *
 * apply_shipment_costs groups by product, so those lines do not race — they MERGE. The cost row ends up
 * holding a quantity-weighted average across all of them, with their freight summed onto it.
 *
 * That is right for the case it was written for: one product genuinely listed twice (a split delivery,
 * two colours of one SKU). It is wrong, and worse than an overwrite, when the matcher put three
 * different products on one row — overwriting would at least leave one real price, whereas the average
 * is a number that appears on no piece of paper. Nothing downstream can tell those two cases apart, so
 * the owner is shown it and decides.
 */
function withSharedProducts(lines: InvoiceLine[]): InvoiceLine[] {
  const count = new Map<string, number>()
  for (const l of lines) {
    if (l.status === 'matched' && l.productId) count.set(l.productId, (count.get(l.productId) ?? 0) + 1)
  }
  return lines.map((l) =>
    l.productId && (count.get(l.productId) ?? 0) > 1 ? { ...l, sharesProductWith: count.get(l.productId)! - 1 } : l)
}

/**
 * What applying this shipment would do to the margin on products that already have a cost.
 *
 * Reads the cost row this apply would overwrite and the product's selling price, projects what the RPC
 * would write, and asks divergence.ts whether the move clears both gates. Nothing here decides anything
 * — the arithmetic is in the isomorphic module so the approval screen previews exactly what the apply
 * gate enforces.
 *
 * Costs only, never variants: apply_shipment_costs writes rows with variant_id NULL and a variant's
 * cost is never touched by a shipment, so a variant row read here would be compared against a figure
 * this apply is not going to change.
 */
async function withDivergence(
  tenantId: string,
  lines: InvoiceLine[],
  exchangeRate: number,
  /** The commission this apply would WRITE. Null means every row keeps its own snapshot. */
  shipmentCommission: number | null,
): Promise<{ lines: InvoiceLine[]; divergences: Divergence[]; affected: Divergence[] }> {
  const matched = lines.filter((l) => l.status === 'matched' && l.productId)
  const productIds = [...new Set(matched.map((l) => l.productId!))]
  if (!productIds.length) return { lines, divergences: [], affected: [] }

  const db = createAdminClient()
  const [{ data: costs }, { data: products }] = await Promise.all([
    db.from('product_costs')
      .select('product_id, cost_primary, shipping_cost, tariff_cost, markup_percent, commission_percent')
      .eq('tenant_id', tenantId).is('variant_id', null).in('product_id', productIds),
    db.from('catalog_products')
      .select('id, name, price').eq('tenant_id', tenantId).in('id', productIds),
  ])

  const costOf = new Map((((costs as Array<Record<string, unknown>> | null) ?? []).map((r) => [r.product_id as string, {
    costPrimary: r.cost_primary === null || r.cost_primary === undefined ? null : Number(r.cost_primary),
    shippingCost: Number(r.shipping_cost ?? 0),
    tariffCost: Number(r.tariff_cost ?? 0),
    markupPercent: Number(r.markup_percent ?? 0),
    commissionPercent: Number(r.commission_percent ?? 0),
  }] as const)))
  const productOf = new Map((((products as Array<Record<string, unknown>> | null) ?? []).map((r) =>
    [r.id as string, { name: (r.name as string | null) ?? null, price: r.price === null || r.price === undefined ? null : Number(r.price) }] as const)))

  const byProduct = new Map<string, Divergence>()
  for (const pid of productIds) {
    // Grouped exactly as the RPC groups — every line of this invoice pointing at the product, together.
    const own = matched.filter((l) => l.productId === pid)
    const prior = own.find((l) => l.priorShipment)?.priorShipment ?? null
    const d = describeDivergence({
      productId: pid,
      productName: productOf.get(pid)?.name ?? own[0]?.productName ?? null,
      current: costOf.get(pid) ?? null,
      next: projectCost(own.map((l) => ({
        extended: l.extended, quantity: l.quantity, allocatedFreight: l.allocatedFreight, allocatedDuties: l.allocatedDuties,
      })), exchangeRate, shipmentCommission ?? costOf.get(pid)?.commissionPercent ?? 0),
      price: productOf.get(pid)?.price ?? null,
      priorQuantity: prior?.quantity ?? null,
      exchangeRate,
    })
    if (d) byProduct.set(pid, d)
  }

  const bySize = (a: Divergence, b: Divergence) => Math.abs(b.delta) - Math.abs(a.delta)
  // `affected` is every product whose cost this apply would move at all; `divergences` is the subset
  // worth putting on screen. Everything below reads one or the other deliberately — never both as if
  // they were the same list.
  const affected = [...byProduct.values()].filter((d) => d.delta !== 0).sort(bySize)
  const flagged = affected.filter(clearsGates)
  const flaggedIds = new Set(flagged.map((d) => d.productId))

  return {
    lines: lines.map((l) => (l.productId && flaggedIds.has(l.productId) ? { ...l, divergence: byProduct.get(l.productId) } : l)),
    divergences: flagged,
    affected,
  }
}

/**
 * Every product this apply would move, flagged or not.
 *
 * Deliberately re-runs withDivergence rather than caching `affected` on ShipmentDetail: the record has
 * to describe the database at the moment of the write, and a value carried from a screen build is as
 * old as the request that produced it.
 */
async function affectedByApply(tenantId: string, detail: ShipmentDetail): Promise<Divergence[]> {
  const r = await withDivergence(
    tenantId,
    detail.lines,
    rateOf(detail.invoice, detail.settings.baseCurrency),
    detail.shipment.commissionPercent,
  )
  return r.affected
}

/** The rate this invoice's purchase prices convert at. 1 for a base-currency invoice, matching the RPC. */
function rateOf(invoice: SupplierInvoice, baseCurrency: string): number {
  if (invoice.currency.toUpperCase() === baseCurrency.toUpperCase()) return 1
  return invoice.exchangeRate && invoice.exchangeRate > 0 ? invoice.exchangeRate : 1
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
  const rows = ((lines as Array<Record<string, unknown>> | null) ?? []).map(lineRow)

  const invoice = invoiceRow(inv as Record<string, unknown>)
  const withPrior = withSharedProducts(await withPriorShipments(g.tenantId, (inv as { id: string }).id, rows))
  const shipment = shipmentRow(ship as Record<string, unknown>)
  const div = await withDivergence(g.tenantId, withPrior, rateOf(invoice, settings.baseCurrency), shipment.commissionPercent)

  return {
    ok: true,
    data: {
      shipment,
      invoice,
      lines: div.lines,
      divergences: div.divergences,
      settings: {
        baseCurrency: settings.baseCurrency,
        secondaryCurrency: settings.secondaryCurrency,
        markupPercent: settings.markupPercent,
        commissionPercent: settings.commissionPercent,
      },
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
 * Turn unmatched invoice lines into products.
 *
 * For a business setting up from scratch the invoices ARE the catalogue — they are the only record of
 * what was bought. This is the step that lets one become the other.
 *
 * ── WHAT IT DELIBERATELY DOES NOT DO ────────────────────────────────────────────────────────────────
 *
 * NO COST ROW. The product is created; the cost lands when the shipment is applied, through the same
 * path as every other matched line. Two ways for a cost to be written is two ways for them to disagree —
 * and a cost written now, before the forwarder's freight is even entered, would be wrong anyway.
 *
 * NO STOCK. The invoice says twenty were bought; having twenty is a different fact about a different
 * moment, and lives in catalog_movements. This tenant imports furniture from Europe: an invoice is
 * issued at SHIPMENT, and the container is at sea for weeks. Auto-receiving would have the voice agent
 * promise a caller a sofa that is mid-Atlantic.
 *
 * NO SELLING PRICE — which is exactly why they are created `draft`. See lib/catalog/types.ts.
 *
 * The SKU is the SUPPLIER's, stored unprefixed. That is what makes their next invoice match these rows
 * exactly instead of creating a second copy of all of them. It borrows their namespace, which is a real
 * cost recorded in OUTSTANDING.md.
 */
export async function createProductsFromLines(
  lineIds: string[],
  names: Record<string, string> = {},
): Promise<Result<ShipmentDetail>> {
  const g = await gate()
  if (g === 'not_found' || g === 'forbidden') return { ok: false, reason: g }

  // Creating products needs the catalog module too. The review screen is gated on `landed_cost` alone,
  // and making rows for a tenant with no catalogue to see them in would be a quiet mess.
  const db = createAdminClient()
  const { data: t } = await db.from('tenants').select('enabled_modules').eq('id', g.tenantId).maybeSingle()
  if (!t || !enabledModulesOf(t).includes('inventory')) {
    return { ok: false, reason: 'not_found', error: 'Turn on the Inventory module to create products from an invoice.' }
  }
  if (!lineIds.length) return { ok: false, reason: 'not_found', error: 'No lines selected.' }

  const { data: rows } = await db.from('supplier_invoice_lines')
    .select('id, line_no, description, sku, invoice_id, status, supplier_invoices!inner(shipment_id)')
    .eq('tenant_id', g.tenantId).in('id', lineIds)
  const lines = (rows as Array<Record<string, unknown>> | null) ?? []
  if (!lines.length) return { ok: false, reason: 'not_found' }

  const shipmentId = (lines[0].supplier_invoices as { shipment_id: string }).shipment_id

  // Existing SKUs first — including drafts. Two lines carrying the same SKU must not become two
  // products, and a SKU already in the catalogue means the line should have matched rather than created.
  const skus = [...new Set(lines.map((l) => (l.sku as string)?.trim()).filter(Boolean))] as string[]
  const existing = new Map<string, string>()
  if (skus.length) {
    const { data: found } = await db.from('catalog_products')
      .select('id, sku').eq('tenant_id', g.tenantId).in('status', ['active', 'draft']).in('sku', skus)
    for (const p of (found as Array<{ id: string; sku: string }> | null) ?? []) {
      existing.set(p.sku.trim().toLowerCase(), p.id)
    }
  }

  for (const line of lines) {
    if (line.status === 'matched') continue           // already points somewhere; leave it alone
    const id = line.id as string
    const sku = ((line.sku as string) ?? '').trim() || null
    const key = sku?.toLowerCase()

    // Already exists — from an earlier selection in this same batch, or from the catalogue. Point the
    // line at it rather than creating a duplicate.
    let productId = key ? existing.get(key) : undefined

    if (!productId) {
      // The name the owner typed on the review screen wins; the raw description is the fallback. It is
      // NOT cleaned up or title-cased — the supplier's shorthand is better evidence than our guess, and
      // the screen gave them the chance to fix it with the line in front of them.
      const name = (names[id] ?? (line.description as string) ?? '').trim().slice(0, 200) || 'Untitled'
      const { data: created, error } = await db.from('catalog_products').insert({
        tenant_id: g.tenantId,
        name,
        sku,
        status: 'draft',                              // in the catalogue, never quotable — see migration 4
        internal_notes: `Created from supplier invoice line ${line.line_no ?? ''}`.trim(),
      }).select('id').single()
      if (error) return { ok: false, reason: 'not_found', error: error.message }
      productId = (created as { id: string }).id
      if (key) existing.set(key, productId)
    }

    await db.from('supplier_invoice_lines').update({
      product_id: productId,
      // Not 'manual': the owner picked nothing from a shortlist, this line MADE the product it points
      // at. True by construction, and rematch() must leave it alone the way it leaves 'manual' alone.
      match_method: 'created',
      match_confidence: null,
      status: 'matched',
      updated_at: new Date().toISOString(),
    }).eq('id', id).eq('tenant_id', g.tenantId)
  }

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
/**
 * The shortlist for one line — and, with `q`, the same scorer run against text the owner typed.
 *
 * ONE function rather than a second search endpoint, because the ordering must agree. The shortlist
 * the screen offers and the results it offers when that shortlist is wrong are then produced by the
 * same matcher that produced the automatic matches, so a product cannot rank first when typed and
 * fourth when suggested. `q` is scored exactly as if the document had said it.
 */
export async function suggestForLine(lineId: string, q?: string | null): Promise<Result<Array<{ id: string; name: string; sku: string | null }>>> {
  const g = await gate()
  if (g === 'not_found' || g === 'forbidden') return { ok: false, reason: g }

  const db = createAdminClient()
  const { data: line } = await db.from('supplier_invoice_lines')
    .select('id, sku, description').eq('id', lineId).eq('tenant_id', g.tenantId).maybeSingle()
  if (!line) return { ok: false, reason: 'not_found' }

  const l = line as Record<string, unknown>
  const typed = (q ?? '').trim()
  const suggestions = await suggestProducts(g.tenantId, typed
    // Typed text replaces BOTH fields rather than being added to them: somebody typing a name after
    // the shortlist missed is correcting the document, not adding to it, and leaving the line's own
    // sku in the query would keep pulling the wrong candidate back up.
    ? { id: l.id as string, sku: null, description: typed }
    : { id: l.id as string, sku: (l.sku as string) ?? null, description: (l.description as string) ?? null })
  return { ok: true, data: suggestions }
}

/**
 * The two things the owner types on the review screen: the forwarder's charges, and the rate paid.
 *
 * They live on different rows — charges on the shipment, rate on the invoice — because they come from
 * two different documents. One call, because to the owner it is one screen and one act.
 */
export async function setShipmentInputs(
  shipmentId: string,
  input: Partial<Charges> & { reference?: string; exchangeRate?: number | null },
): Promise<Result<ShipmentDetail>> {
  const g = await gate()
  if (g === 'not_found' || g === 'forbidden') return { ok: false, reason: g }

  const db = createAdminClient()

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (input.freightTotal !== undefined) patch.freight_total = Math.max(0, input.freightTotal)
  if (input.dutiesTotal !== undefined) patch.duties_total = Math.max(0, input.dutiesTotal)
  if (input.otherTotal !== undefined) patch.other_total = Math.max(0, input.otherTotal)
  if (input.reference !== undefined) patch.reference = input.reference.slice(0, 200) || null

  const { error } = await db.from('landed_cost_shipments').update(patch).eq('id', shipmentId).eq('tenant_id', g.tenantId)
  if (error) return { ok: false, reason: 'not_found', error: error.message }

  // The rate belongs to the INVOICE, not the shipment: it is a fact about the document it was paid on,
  // and phase 2 hangs several invoices — potentially bought at different rates — off one shipment.
  if (input.exchangeRate !== undefined) {
    const rate = input.exchangeRate === null || input.exchangeRate <= 0 ? null : input.exchangeRate
    const { error: re } = await db.from('supplier_invoices')
      .update({ exchange_rate: rate, updated_at: new Date().toISOString() })
      .eq('shipment_id', shipmentId).eq('tenant_id', g.tenantId)
    if (re) return { ok: false, reason: 'not_found', error: re.message }
  }

  await reallocate(g.tenantId, shipmentId)
  return getShipment(shipmentId)
}

/**
 * Write the allocation onto the products.
 *
 * One RPC, one transaction — see add_landed_cost_invoices.sql for why this path uses the admin client
 * while every other cost write goes through the RLS-scoped one. Coverage, allocation totals and tenancy
 * are re-derived in SQL rather than trusted from here, so a bug in this file can fail the apply but
 * cannot corrupt a cost row.
 *
 * ── THE ONE GUARD THAT IS NOT RE-DERIVED IN SQL ─────────────────────────────────────────────────────
 *
 * The divergence gate below lives here and only here. The RPC could in principle recompute which costs
 * move materially, but it could never recompute the fact the gate is actually about — that a human was
 * shown the sentence and went ahead anyway. So the RPC RECORDS the acknowledgement; it does not enforce
 * it. Said plainly because the alternative is a comment above this function claiming every guard is in
 * SQL, which would be false the day this shipped.
 */
export async function applyShipment(
  shipmentId: string,
  opts: { override?: boolean; reapply?: boolean; acknowledgeDivergence?: boolean } = {},
): Promise<ApplyResult> {
  const g = await gate()
  if (g === 'not_found' || g === 'forbidden') return { ok: false, reason: g }

  // Recomputed immediately before the write, not just after each edit. Matching can change without this
  // feature knowing: deleting a product un-matches its invoice lines through a database trigger, and a
  // shipment left in review across that would otherwise reach the RPC holding an allocation that no
  // longer covers its charges — and be refused for a reason the owner did not cause and cannot see.
  await reallocate(g.tenantId, shipmentId)

  // Recomputed here too, from the database, for the same reason and one more: the screen's copy is as
  // old as the tab. What is acknowledged has to be what is about to happen, not what was true when the
  // page loaded — otherwise the record says he saw a figure he did not see.
  const current = await getShipment(shipmentId)
  if (!current.ok) return current
  const divergences = current.data.divergences
  const currency = current.data.settings.baseCurrency

  // Everything this apply would move, not just what cleared the thresholds. Recomputed here rather
  // than carried on ShipmentDetail because it is only ever needed at the moment of the write.
  const affected = await affectedByApply(g.tenantId, current.data)

  if (divergences.length && !opts.acknowledgeDivergence) {
    return {
      ok: false,
      reason: 'divergence',
      error: divergences.map((d) => divergenceSentence(d, currency)).join(' '),
      divergences,
    }
  }

  const { error } = await createAdminClient().rpc('apply_shipment_costs', {
    p_tenant: g.tenantId,
    p_shipment: shipmentId,
    p_actor: g.actorUserId,
    // The owner may overrule the coverage threshold, and that override travels as a number the database
    // enforces rather than as a boolean this file could forget to check.
    p_min_coverage: opts.override ? 0 : MIN_COVERAGE,
    p_reapply: Boolean(opts.reapply),
    // What was on screen when he pressed the button, in the words it was on screen in. Six months from
    // now "why is this sofa's margin 19%" is answerable from this row alone — which products moved, by
    // how much, and that somebody was told before it happened.
    // ── THREE DIFFERENT FACTS, THREE DIFFERENT FIELDS ───────────────────────────────────────────
    //
    // Every product whose cost moves is recorded — that is what `entries` is. Within an entry:
    //
    //   flagged      — did this move clear both thresholds. SERVER-DERIVED from the numbers beside
    //                  it, so it is reproducible and cannot be wrong about itself.
    //   sentence     — the wording for this row, when there is one. Deliberately NOT called `shown`:
    //                  it is the text that exists, not a claim that anyone read it.
    //   acknowledged — a human was shown this and went ahead. A CLAIM ONLY THE CLIENT CAN MAKE, and
    //                  only from the block that renders the sentences beside the button.
    //
    // These were two fields until 7 Aug 2026, when `shown` carried both the wording and the
    // assertion that it had been displayed. A stale tab then moved 166 products' costs with a record
    // saying their sentences had been read while the banner was never on screen — a false artefact,
    // which is worse than a missing one, and the exact failure the server-side recompute exists to
    // prevent. Conflating "was worth showing" with "was shown" is how it became possible; splitting
    // them is what makes it impossible rather than unlikely.
    //
    // Why every affected product and not just the flagged ones: a 25% commission moves everything on
    // a shipment by the same proportion, but the $5 floor means only purchase prices above ~18.18
    // clear it — so a third of a shipment changes unflagged. Recording only the flagged ones would
    // leave those with no before-figure anywhere, because applied_before is first-write-wins and
    // does not re-snapshot on a re-apply.
    p_divergence: affected.length
      ? {
          entries: affected.map((d) => {
            const flagged = clearsGates(d)
            return {
              productId: d.productId,
              productName: d.productName,
              previousCost: d.previousCost,
              nextCost: d.nextCost,
              delta: d.delta,
              deltaRelative: d.deltaRelative,
              price: d.price,
              previousMargin: d.previousMargin,
              nextMargin: d.nextMargin,
              shapes: d.shapes.map((sh) => ({ kind: sh.kind, factor: sh.factor })),
              flagged,
              sentence: flagged ? divergenceSentence(d, currency) : null,
              // Unflagged rows were never rendered, so they can never be acknowledged — regardless of
              // what the request asked for.
              acknowledged: flagged && opts.acknowledgeDivergence === true,
            }
          }),
        }
      : null,
  })
  if (error) return { ok: false, reason: 'not_found', error: error.message }
  return getShipment(shipmentId)
}

/** Coverage for a set of lines — re-exported so routes and the UI never recompute it differently. */
export { coverage, MIN_COVERAGE, MAX_INVOICE_BYTES }
