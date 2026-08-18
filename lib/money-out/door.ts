import { createHash } from 'crypto'
import { createAdminClient } from '@/lib/supabase/server'
import { requireActiveBusinessContext } from '@/lib/workspace'
import { enabledModulesOf } from '@/lib/modules'
import { getCostSettings } from '@/lib/catalog/costs'
import { createShipmentFromFile, findDuplicate } from '@/lib/invoices/store'
import { extractInvoice, extendedOf, pageCountOf } from '@/lib/invoices/extract'
import { EXTRACTABLE_EXTENSIONS, extensionOf, invoiceFileError, type DuplicateWarning } from '@/lib/invoices/types'
import { readReceipt, resolveSpentOn, type ReceiptReading } from '@/lib/expenses/extract'
import type { ExtractedInvoice } from '@/lib/invoices/extract'

// THE ONE DOOR. Every document that represents money leaving comes in through here.
//
// See lib/invoices/OUTSTANDING.md §10 for the decision and the reasoning; this file is the shape of
// it. The short version: an owner was being asked to make an accounting distinction — operating
// expense or cost of goods — BEFORE they knew what was in the document, and in our vocabulary rather
// than theirs. Theirs is "I got a piece of paper, put it in". So there is one way in, and what the
// document turns out to be decides where it lands.
//
//   no landed_cost module      → an expense, no question asked
//   landed_cost, no lines      → an expense, no question asked
//   landed_cost, lines         → a supplier bill; matching has already run by the time it lands
//
// The third case splits again on the bill screen rather than here: a bill where NOTHING matched is
// the one state that asks, and it asks with the two actions that answer it — create these as
// products, or move this to Money out. Deliberately not a dismissible flag on a row: while nothing
// is matched the question is still true, and a screen that remembers being told "they are products"
// while showing nothing matched would be storing an answer that contradicts itself.
//
// ── TWO SCHEMAS, PICKED BY MODULE. NEVER BY GUESSING AT THE DOCUMENT ────────────────────────────
//
// Not both — for a locksmith the invoice read is pure waste on every petrol receipt, and the door
// already knows they have no catalogue. Not one-with-a-fallback — there is nothing to fall back ON:
// a one-page supplier invoice read against the receipt schema comes back with a merchant and a total
// and SILENTLY DROPS EVERY LINE, with no signal that matching was skipped. The invoice schema is the
// superset and degrades the other way round: run on a petrol receipt it returns no lines and a grand
// total, which is exactly what the expense form wants.
//
// So the SCHEMA comes from a fact. Only the DIALS come from a guess, and a wrong guess there costs
// seconds or fractions of a cent and can never cost a line item.
//
// Merging the two prompts was considered and rejected — they have opposite virtues, "return null
// rather than guess" against "follow the column, never invent a total", and a merged prompt getting
// quietly worse at one of its two jobs is the kind of thing you find out about from a wrong number.
// Revisit when there is fill-rate data from real receipts on a catalogue tenant; the meter already
// records what every read costs.

/** What the door decided, and everything the screen needs to act on it. */
export type Landing =
  | {
      kind: 'expense'
      reading: ReceiptReading
      /** For the duplicate check at save. Nothing is stored yet — see the read-first note below. */
      fileHash: string
      duplicate: DuplicateHint | null
    }
  | { kind: 'bill'; shipmentId: string; duplicate: DuplicateWarning | null }

export type DoorResult =
  | { ok: true; landing: Landing }
  | { ok: false; error: string; status: 400 | 403 }

/** The same paper, already here. Never blocks — see OUTSTANDING.md §10f. */
export interface DuplicateHint {
  where: 'expense' | 'bill'
  id: string
  /** What to call it in the sentence: a merchant, or a supplier and number. */
  label: string
}

/**
 * How long this read is going to take, guessed from the bytes.
 *
 * A phone photograph of a receipt is one page and a few hundred kilobytes; a supplier invoice is a
 * multi-page PDF. `pageCountOf` is a pure byte scan with no dependencies that cannot throw — it is an
 * optimisation, and an optimisation must never be able to fail the thing it is optimising, which is
 * the lesson its own header records.
 *
 * This decides three things together, because they are the same question asked three ways: how hard
 * the model should think, how much it may write, and — the one that matters most — WHETHER THE ROWS
 * GO IN BEFORE OR AFTER THE READ.
 */
export function triage(bytes: Buffer, mimeType: string): { long: boolean; pageCount: number | null } {
  const pageCount = pageCountOf(bytes, mimeType)
  // An image is one page by definition, and nobody photographs fifteen pages of an invoice with one
  // tap. A PDF whose page count we could not read is treated as long: guessing "short" would put a
  // fifteen-page document on the read-first path, where a failure leaves the person with nothing on
  // screen at all, and that is the worse of the two errors.
  const long = mimeType === 'application/pdf' && (pageCount === null || pageCount > 1)
  return { long, pageCount }
}

/**
 * A float from the invoice reader, as integer cents.
 *
 * NOT parseAmountCents, and the difference is provenance rather than taste. That function turns
 * something a HUMAN WROTE into cents and is the only thing allowed to; the receipt reader returns
 * printed text precisely so it can go through it. The invoice reader returns numbers — its schema
 * says `number | null` — so there is no text here to parse, and this is the one place a figure that
 * was already a number becomes cents.
 */
const centsOf = (n: number | null): number | null =>
  n === null || !Number.isFinite(n) ? null : Math.round(n * 100)

/**
 * An invoice extraction, read as an expense.
 *
 * Every field the expense form needs is already on the invoice read except the category, which the
 * invoice schema has no reason to carry — so it comes back null and the person picks it, which is
 * one tap on a form they are already checking against the paper.
 *
 * `readable` is 'receipt' rather than anything cleverer: by the time this runs the document HAS been
 * read, and the three-way flag exists to tell "I photographed my dog" from "the print has faded".
 * Neither of those produces a grand total.
 */
export function expenseFromInvoice(inv: ExtractedInvoice, today: string): ReceiptReading {
  const amountCents = centsOf(inv.grandTotal)
  const taxRaw = centsOf(inv.taxTotal)
  return {
    readable: amountCents === null ? 'unreadable' : 'receipt',
    merchant: inv.supplierName?.trim().slice(0, 200) || null,
    amountCents: amountCents !== null && amountCents > 0 ? amountCents : null,
    // Same rule shapeReading applies: tax that is not smaller than the total is a misread, not a
    // discovery, and the form would refuse it at save anyway.
    taxCents: taxRaw !== null && amountCents !== null && taxRaw < amountCents ? taxRaw : null,
    spentOn: resolveSpentOn(inv.invoiceDate, today),
    datePrinted: inv.invoiceDate,
    currency: /^[A-Z]{3}$/.test((inv.currency || '').toUpperCase()) ? inv.currency.toUpperCase() : null,
    category: null,
  }
}

/**
 * Has this exact file been here before — in EITHER table?
 *
 * One door stops the same paper landing in both; it does nothing about the same paper landing twice
 * in one, which was already possible and, on the expenses side, completely silent. Warns, never
 * blocks: re-uploading after a failed read is legitimate and the owner knows which of the two they
 * meant.
 *
 * Only the byte-identical file. The same invoice photographed twice hashes differently — what
 * catches those is supplier plus invoice number, which findDuplicate already checks on the bill path
 * once the document has been read.
 */
export async function findAnywhere(tenantId: string, fileHash: string): Promise<DuplicateHint | null> {
  const db = createAdminClient()
  const [{ data: expense }, { data: invoice }] = await Promise.all([
    db.from('expenses').select('id, merchant, spent_on')
      .eq('tenant_id', tenantId).eq('file_hash', fileHash).limit(1).maybeSingle(),
    db.from('supplier_invoices').select('shipment_id, supplier_name, invoice_number')
      .eq('tenant_id', tenantId).eq('file_hash', fileHash).limit(1).maybeSingle(),
  ])

  if (expense) {
    const e = expense as { id: string; merchant: string | null; spent_on: string }
    return { where: 'expense', id: e.id, label: [e.merchant, e.spent_on].filter(Boolean).join(' · ') || 'an expense' }
  }
  if (invoice) {
    const i = invoice as { shipment_id: string; supplier_name: string | null; invoice_number: string | null }
    return { where: 'bill', id: i.shipment_id, label: [i.supplier_name, i.invoice_number].filter(Boolean).join(' ') || 'a supplier bill' }
  }
  return null
}

/**
 * Open the door.
 *
 * Gated like everything else that spends: `canViewCosts`, because a White Label operator who may not
 * see what a business pays in rent may not read its documents either. NOT gated on a module — every
 * business spends money, and `landed_cost` being off is exactly why a locksmith's Money out reads $0.
 */
export async function openDoor(file: File): Promise<DoorResult> {
  const ctx = await requireActiveBusinessContext()
  if (!ctx || !ctx.capabilities.canViewCosts) {
    return { ok: false, error: 'You do not have permission to do that.', status: 403 }
  }

  // The invoice path's limits, which are the wider of the two, because this door takes both kinds of
  // document. A file acceptable at the picker and refused here is a person told their photo is fine
  // and then told it is not.
  const problem = invoiceFileError(file.name, file.size)
  if (problem) return { ok: false, error: problem, status: 400 }

  const mimeType = EXTRACTABLE_EXTENSIONS[extensionOf(file.name)]
  const bytes = Buffer.from(await file.arrayBuffer())
  const fileHash = createHash('sha256').update(bytes).digest('hex')

  const db = createAdminClient()
  const { data: tenant } = await db.from('tenants').select('enabled_modules').eq('id', ctx.tenantId).maybeSingle()
  const hasCatalogue = !!tenant && enabledModulesOf(tenant).includes('landed_cost')
  const today = new Date().toISOString().slice(0, 10)

  // ── THE SIMPLE TENANT ──────────────────────────────────────────────────────────────────────────
  // No supplier bills exist for them at all, so there is nothing to decide and nothing to ask. This
  // is the majority of tenants and it costs exactly what expenses cost before the door existed.
  if (!hasCatalogue) {
    const r = await readReceipt(ctx.tenantId, bytes, mimeType, today)
    return {
      ok: true,
      landing: { kind: 'expense', reading: r.reading, fileHash, duplicate: await findAnywhere(ctx.tenantId, fileHash) },
    }
  }

  const { long } = triage(bytes, mimeType)

  // ── THE LONG READ: ROWS FIRST ──────────────────────────────────────────────────────────────────
  // A multi-page PDF takes minutes and the person will not sit and watch it. createShipmentFromFile
  // writes the shipment and invoice rows before it reads, so a failure or an abandoned tab leaves
  // something on screen carrying the reason rather than a file nobody can see.
  //
  // A document this shape is a supplier invoice essentially always — nobody photographs a petrol
  // receipt as a fifteen-page PDF — so landing it as a bill and letting the screen offer "this is an
  // expense" is the right way round. The alternative, holding it in limbo until somebody answers a
  // question, is the limbo this door exists to remove.
  if (long) {
    const r = await createShipmentFromFile(file)
    if (!r.ok) return { ok: false, error: r.error || 'That document could not be read.', status: 400 }
    return { ok: true, landing: { kind: 'bill', shipmentId: r.data.shipmentId, duplicate: r.data.duplicate } }
  }

  // ── THE SHORT READ: READ FIRST, STORE NOTHING YET ──────────────────────────────────────────────
  // One page with a person watching. Reading before anything is written is what lets a document that
  // turns out to be an expense leave no shipment behind — and it is what keeps the expenses rule
  // ("the bucket never holds a file nothing points at") true without a reaper.
  const settings = await getCostSettings(ctx.tenantId)
  const ex = await extractInvoice(ctx.tenantId, bytes, mimeType, settings.baseCurrency)

  // NO PRODUCT LINES IS NOT AN AMBIGUOUS DOCUMENT — it is a document with nothing on it to sell.
  // Asking "are these products you sell?" about a page with no products on it is exactly the kind of
  // question this design deletes. (This is a refinement of the rule as first written, which asked
  // whenever nothing MATCHED; nothing matched and nothing to match are different facts.)
  const productLines = ex.invoice.lines.filter((l) => extendedOf(l) !== 0 || l.description)
  if (productLines.length === 0) {
    return {
      ok: true,
      landing: {
        kind: 'expense',
        reading: expenseFromInvoice(ex.invoice, today),
        fileHash,
        duplicate: await findAnywhere(ctx.tenantId, fileHash),
      },
    }
  }

  // It has product lines, so it is a bill — and the extraction already paid for goes in with it
  // rather than being run a second time.
  const r = await createShipmentFromFile(file, ex)
  if (!r.ok) return { ok: false, error: r.error || 'That document could not be read.', status: 400 }
  return { ok: true, landing: { kind: 'bill', shipmentId: r.data.shipmentId, duplicate: r.data.duplicate } }
}

/** Re-exported so the route and the door agree about what a duplicate is. */
export { findDuplicate }
