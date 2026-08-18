import { createAdminClient } from '@/lib/supabase/server'
import { requireActiveBusinessContext } from '@/lib/workspace'
import { getShipment } from '@/lib/invoices/store'
import { CATEGORY_KEYS } from '@/lib/expenses/categories'

// MOVING A BILL THAT WAS NEVER STOCK.
//
// The one door decides from the document, and the document is sometimes not enough: a supplier's
// invoice for a service, a delivery note with prices on it, a bill from somebody the business does
// not buy stock from. Those land as bills because they have lines on them, and this is how they get
// out. See OUTSTANDING.md §10e.
//
// ── ONE DIRECTION IS FREE AND THE OTHER IS NOT ─────────────────────────────────────────────────
//
// This one is free. Supplier, number, date, currency and grand total were all extracted when the
// document arrived, so nothing has to be read again — the row is built from what is already stored.
// (Expense → bill is the expensive direction: the expense path never extracted the lines, so they do
// not exist to promote and the document has to be read a second time.)
//
// The FILE does not move. Both tables store into the same bucket — lib/expenses/store.ts re-exports
// INVOICE_BUCKET rather than opening a second one — so the expense row points at the object the
// invoice was already pointing at, and the proof survives with the row.
//
// ── AND AN APPLIED BILL DOES NOT MOVE AT ALL ───────────────────────────────────────────────────
//
// Refused here as well as on the screen. Its costs are ON the products — 126 of them for PRIMAVERA —
// and an expense row cannot carry them, so moving it would leave those products holding freight from
// a document that no longer exists as a bill and no way to find out why. Undoing an apply is a
// different feature with a design of its own: what a product's cost becomes when the shipment that
// set it is withdrawn is a question this pipeline has never had to answer, and `applied_before` is
// first-write-wins so it is not a restore point either.

export type ReclassifyResult =
  | { ok: true; expenseId: string }
  | { ok: false; error: string; status: 400 | 403 | 404 | 409 }

/** Everything the screen shows before it asks for the one thing it cannot know. */
export interface BillAsExpense {
  merchant: string
  amountCents: number | null
  taxCents: number | null
  spentOn: string
  currency: string
}

const centsOf = (n: number | null): number | null =>
  n === null || !Number.isFinite(n) ? null : Math.round(n * 100)

/**
 * Turn a supplier bill into an expense.
 *
 * The CATEGORY comes from the person and nothing else. Every other field is transcribed from the
 * document, but the category is an accounting judgement that is not written anywhere on the paper —
 * and it is the field the export groups by, so a guess here is a wrong line in somebody's return
 * rather than a wrong pixel. The screen asks for it and this refuses without it.
 */
export async function billToExpense(shipmentId: string, category: string): Promise<ReclassifyResult> {
  const ctx = await requireActiveBusinessContext()
  if (!ctx || !ctx.capabilities.canViewCosts) {
    return { ok: false, error: 'You do not have permission to do that.', status: 403 }
  }
  if (!CATEGORY_KEYS.includes(category)) {
    return { ok: false, error: 'Pick a category for this expense.', status: 400 }
  }

  // Through getShipment rather than a second query onto the tables: that function is where the
  // tenant gate and the module check live, and a second door onto them is a second thing that can
  // forget one.
  const res = await getShipment(shipmentId)
  if (!res.ok) return { ok: false, error: 'That bill no longer exists.', status: 404 }
  const { shipment, invoice } = res.data

  if (shipment.status === 'applied') {
    return {
      ok: false,
      status: 409,
      error: 'This bill has already been applied, so its costs are on your products. It cannot be moved to Money out.',
    }
  }

  const db = createAdminClient()

  // The storage path lives on the invoice row and is deliberately never handed to a browser, so it
  // is read here rather than carried through the screen.
  const { data: inv } = await db.from('supplier_invoices')
    .select('storage_path, file_name, file_hash').eq('id', invoice.id).eq('tenant_id', ctx.tenantId).maybeSingle()
  const stored = inv as { storage_path: string; file_name: string; file_hash: string | null } | null

  const amountCents = centsOf(invoice.grandTotal)
  if (amountCents === null || amountCents <= 0) {
    // Every expense has an amount — the column is NOT NULL and the form refuses a zero. A bill whose
    // total could not be read has nothing to become, and saying so is better than writing a row of
    // zeroes somebody has to find later.
    return {
      ok: false,
      status: 409,
      error: 'No total could be read off this document, so there is no amount to record. Add it as an expense by hand instead.',
    }
  }
  const taxRaw = centsOf(invoice.taxTotal)

  const { data: created, error } = await db.from('expenses').insert({
    tenant_id: ctx.tenantId,
    // The date on the paper, not today — the same rule the expenses table was built on. Falls back
    // to when the document arrived, which is the closest true thing we have.
    spent_on: invoice.invoiceDate ?? shipment.createdAt.slice(0, 10),
    merchant: (invoice.supplierName || shipment.reference || invoice.fileName).slice(0, 200),
    amount_cents: amountCents,
    tax_cents: taxRaw !== null && taxRaw < amountCents ? taxRaw : null,
    category,
    note: invoice.invoiceNumber ? `Invoice ${invoice.invoiceNumber}` : null,
    // The same object, still in the same bucket. Nothing is copied and nothing is re-uploaded.
    receipt_path: stored?.storage_path ?? null,
    receipt_name: stored?.file_name ?? null,
    file_hash: stored?.file_hash ?? null,
    created_by: ctx.actorUserId,
  }).select('id').single()

  if (error || !created) return { ok: false, error: 'That bill could not be moved.', status: 400 }

  // The expense EXISTS before the bill stops existing. The other order would leave a window where
  // the money is recorded nowhere, and a failure in it would lose the document entirely — where this
  // way the worst case is the same paper in both places, which is the state the whole feature is
  // built to warn about rather than the state where it has vanished.
  //
  // The invoice and its lines go with the shipment: both foreign keys are ON DELETE CASCADE. The
  // FILE is deliberately not removed — the expense row now points at it.
  const { error: del } = await db.from('landed_cost_shipments')
    .delete().eq('id', shipmentId).eq('tenant_id', ctx.tenantId)
  if (del) {
    // The expense is already written and correct. Saying "half of this worked" is more use than
    // rolling back a row that is now the true record of the money.
    return {
      ok: false,
      status: 409,
      error: 'The expense was recorded, but the bill could not be removed. Delete it from Supplier bills so it is not counted twice.',
    }
  }

  return { ok: true, expenseId: (created as { id: string }).id }
}
