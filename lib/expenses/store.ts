import { createClient, createAdminClient } from '@/lib/supabase/server'
import { requireActiveBusinessContext } from '@/lib/workspace'
import { INVOICE_BUCKET } from '@/lib/invoices/store'
import {
  RECEIPT_STORED_TYPES, RECEIPT_EXTENSIONS, receiptExtensionOf, receiptFileError, type ReceiptChange,
} from './receipt'
import { recoversTaxOnExpenses } from './recoverable-tax'
import type { ExpenseInput } from './schema'

// READING AND WRITING EXPENSES.
//
// ── THE GATE ────────────────────────────────────────────────────────────────────────────────────
//
// Same shape as supplier invoices, including `canViewCosts` — and that flag matters MORE here, not
// less. A supplier invoice is what the business pays for stock; this table is rent, payroll and the
// owner's insurance. A White Label partner operates a client's workspace and is not the client, so no
// partner role sees any of it. Refused before a row is read, rather than hidden afterwards.
//
// NOT gated on a module, though. Every business spends money — `landed_cost` being off is exactly why
// a locksmith's Money out reads $0 today, and putting expenses behind a second module would reproduce
// the fault it exists to fix.

/** The bucket is the supplier-invoice one, deliberately. See the migration's header. */
export { INVOICE_BUCKET as RECEIPT_BUCKET }

export interface ExpenseRow {
  id: string
  spentOn: string
  merchant: string
  amountCents: number
  taxCents: number | null
  currency: string
  category: string
  note: string | null
  hasReceipt: boolean
  receiptName: string | null
  createdAt: string
}

export interface ExpenseList {
  rows: ExpenseRow[]
  totalCents: number
  /** Sum of the recoverable portions. Only meaningful when `showsTax`. */
  recoverableCents: number
  withReceipt: number
  /** Whether this business recovers tax — decides the second money field. See recoverable-tax.ts. */
  showsTax: boolean
  currency: string
}

type Gate = { tenantId: string; actorUserId: string }

/** Null means refused — no session, no workspace, or an operator who may not see costs. */
async function gate(): Promise<Gate | null> {
  const c = await requireActiveBusinessContext()
  if (!c) return null
  if (!c.capabilities.canViewCosts) return null
  return { tenantId: c.tenantId, actorUserId: c.actorUserId }
}

const rowOf = (r: Record<string, unknown>): ExpenseRow => ({
  id: r.id as string,
  spentOn: r.spent_on as string,
  merchant: (r.merchant as string) ?? '',
  amountCents: Number(r.amount_cents ?? 0),
  taxCents: r.tax_cents === null || r.tax_cents === undefined ? null : Number(r.tax_cents),
  currency: ((r.currency as string) || 'usd').toUpperCase(),
  category: r.category as string,
  note: (r.note as string) ?? null,
  // The PATH is never handed to the browser. A signed URL is minted on demand for one file at a time;
  // shipping storage paths to a list view would leak the shape of every tenant's private bucket.
  hasReceipt: !!r.receipt_path,
  receiptName: (r.receipt_name as string) ?? null,
  createdAt: r.created_at as string,
})

/**
 * Whether this tenant recovers tax, from the two signals recoverable-tax.ts accepts.
 *
 * Both reads are `head: true` where possible and neither is expensive, but they are also facts that
 * do not change between one page load and the next — a candidate for caching the day the screen is
 * hot, and deliberately not cached today, because a wrong cached answer here shows a tax box to a
 * business that has none.
 */
export async function taxSignals(tenantId: string): Promise<boolean> {
  const db = createAdminClient()
  const [{ data: tenant }, { count }] = await Promise.all([
    db.from('tenants').select('state').eq('id', tenantId).maybeSingle(),
    db.from('orders').select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId).not('delivery_province', 'is', null),
  ])
  return recoversTaxOnExpenses({
    state: (tenant as { state?: string | null } | null)?.state ?? null,
    hasCanadianOrder: (count ?? 0) > 0,
  })
}

/** Every expense, newest receipt date first. Null when the gate refused. */
export async function readExpenses(): Promise<ExpenseList | null> {
  const g = await gate()
  if (!g) return null

  const db = await createClient()
  const { data } = await db
    .from('expenses')
    .select('*')
    .eq('tenant_id', g.tenantId)
    // The date on the RECEIPT, not when it was typed. created_at breaks the tie so two receipts from
    // the same day keep a stable order instead of shuffling between renders.
    .order('spent_on', { ascending: false })
    .order('created_at', { ascending: false })

  const rows = ((data ?? []) as Record<string, unknown>[]).map(rowOf)
  return {
    rows,
    totalCents: rows.reduce((n, r) => n + r.amountCents, 0),
    recoverableCents: rows.reduce((n, r) => n + (r.taxCents ?? 0), 0),
    withReceipt: rows.filter((r) => r.hasReceipt).length,
    showsTax: await taxSignals(g.tenantId),
    currency: rows[0]?.currency ?? 'USD',
  }
}

export type CreateResult =
  | { ok: true; expense: ExpenseRow }
  | { ok: false; error: string; field?: string }

type StoredReceipt = { path: string; name: string }

/**
 * Put one receipt in the bucket, or say why not. Shared by create and update so a file that is
 * acceptable on the way in is acceptable on the way back in — a second copy of these three checks is
 * how "you can attach a HEIC" and "you cannot replace with a HEIC" become true at the same time.
 */
async function putReceipt(
  db: ReturnType<typeof createAdminClient>,
  tenantId: string,
  file: File,
): Promise<{ ok: true; stored: StoredReceipt } | { ok: false; error: string; field: 'receipt' }> {
  const problem = receiptFileError(file.name, file.size)
  if (problem) return { ok: false, error: problem, field: 'receipt' }

  const ext = receiptExtensionOf(file.name)
  const mimeType = RECEIPT_EXTENSIONS[ext]
  // The downscale is supposed to have turned a HEIC into a JPEG on the way here. If one arrives
  // anyway — a browser that could not decode it, or something posting directly — it is refused
  // rather than stored, because the bucket would take it and then nothing could ever display it.
  if (!mimeType || !RECEIPT_STORED_TYPES.has(mimeType)) {
    return { ok: false, error: 'That photo could not be prepared. Try a JPG, PNG or PDF.', field: 'receipt' }
  }

  // Tenant-first, like every other path in this bucket, so isolation is visible in the key as well
  // as enforced by the read.
  const path = `${tenantId}/expenses/${crypto.randomUUID()}.${ext === 'jpeg' ? 'jpg' : ext}`
  const bytes = new Uint8Array(await file.arrayBuffer())
  // OUR content type, never the browser's claim — the uploader does not decide how the file is
  // served back.
  const up = await db.storage.from(INVOICE_BUCKET).upload(path, bytes, { contentType: mimeType, upsert: false })
  if (up.error) return { ok: false, error: 'That receipt could not be saved.', field: 'receipt' }

  return { ok: true, stored: { path, name: file.name.slice(0, 200) } }
}

/**
 * Write one expense, with its receipt if there is one.
 *
 * The file goes up FIRST and is removed again if the insert fails, so a failed save cannot leave an
 * orphan in the bucket that nothing points at and nobody will ever find.
 */
export async function createExpense(
  input: ExpenseInput,
  file: File | null,
  /** SHA-256 of what the door read, for the duplicate warning. Null when this was typed by hand. */
  fileHash: string | null = null,
): Promise<CreateResult> {
  const g = await gate()
  if (!g) return { ok: false, error: 'Unauthorized' }

  const db = createAdminClient()

  let storagePath: string | null = null
  let receiptName: string | null = null

  if (file && file.size > 0) {
    const put = await putReceipt(db, g.tenantId, file)
    if (!put.ok) return put
    storagePath = put.stored.path
    receiptName = put.stored.name
  }

  const { data, error } = await db.from('expenses').insert({
    tenant_id: g.tenantId,
    spent_on: input.spentOn,
    merchant: input.merchant,
    amount_cents: input.amountCents,
    tax_cents: input.taxCents,
    category: input.category,
    note: input.note,
    receipt_path: storagePath,
    receipt_name: receiptName,
    file_hash: fileHash,
    created_by: g.actorUserId,
  }).select('*').single()

  if (error || !data) {
    if (storagePath) await db.storage.from(INVOICE_BUCKET).remove([storagePath])
    return { ok: false, error: 'That expense could not be saved.' }
  }

  return { ok: true, expense: rowOf(data as Record<string, unknown>) }
}

/**
 * Correct one expense.
 *
 * ── WHY THIS EXISTS BEFORE ANYTHING READS A RECEIPT ─────────────────────────────────────────────
 *
 * Extraction fills these fields from a photograph and the person confirms them. A confirmation is
 * only meaningful if a wrong one can be taken back, so the correction path is a PRECONDITION of the
 * suggestion path, not a follow-up to it. Shipping the reader first would mean the software could
 * produce a wrong row that nobody could fix.
 *
 * ── THE ORDER THE FILE MOVES IN ─────────────────────────────────────────────────────────────────
 *
 * A replacement goes up BEFORE the row is written and is removed again if the write fails — the same
 * no-orphan rule as createExpense. The OLD file is removed only AFTER the row no longer points at
 * it. Both halves are the same principle from opposite ends: the bucket may briefly hold a file
 * nothing references, and must never lack one something does.
 */
export async function updateExpense(id: string, input: ExpenseInput, receipt: ReceiptChange): Promise<CreateResult> {
  const g = await gate()
  if (!g) return { ok: false, error: 'Unauthorized' }

  const db = createAdminClient()

  // Read first, for the old path and to establish the row is this tenant's. The update below is
  // scoped to the tenant as well — this read is not the authorisation, it is what tells the
  // difference between "not yours" and "the write failed", which are different sentences.
  const { data: existing } = await db
    .from('expenses').select('receipt_path').eq('id', id).eq('tenant_id', g.tenantId).maybeSingle()
  if (!existing) return { ok: false, error: 'That expense no longer exists.' }
  const oldPath = (existing as { receipt_path?: string | null }).receipt_path ?? null

  let uploaded: StoredReceipt | null = null
  if (receipt.kind === 'replace') {
    const put = await putReceipt(db, g.tenantId, receipt.file)
    if (!put.ok) return put
    uploaded = put.stored
  }

  const patch: Record<string, unknown> = {
    spent_on: input.spentOn,
    merchant: input.merchant,
    amount_cents: input.amountCents,
    tax_cents: input.taxCents,
    category: input.category,
    note: input.note,
    updated_at: new Date().toISOString(),
  }
  // Untouched on 'keep' — writing receipt_path back as itself would be harmless today and would be
  // the line that clears it the day this function grows a code path that forgets to set it.
  if (receipt.kind === 'remove') { patch.receipt_path = null; patch.receipt_name = null }
  if (uploaded) { patch.receipt_path = uploaded.path; patch.receipt_name = uploaded.name }

  const { data, error } = await db
    .from('expenses').update(patch).eq('id', id).eq('tenant_id', g.tenantId).select('*').single()

  if (error || !data) {
    if (uploaded) await db.storage.from(INVOICE_BUCKET).remove([uploaded.path])
    return { ok: false, error: 'That change could not be saved.' }
  }

  // Now that nothing points at it. A failure here leaves a file nobody can reach, which is a bill for
  // a few kilobytes; failing the other way round would leave a row whose receipt link 404s, which is
  // the person's proof gone with the screen still claiming they have it.
  if (oldPath && (receipt.kind === 'remove' || uploaded)) {
    await db.storage.from(INVOICE_BUCKET).remove([oldPath])
  }

  return { ok: true, expense: rowOf(data as Record<string, unknown>) }
}

/**
 * Remove one expense and its receipt.
 *
 * The row goes first, for the reason above: an orphaned object costs storage, where an orphaned row
 * shows a receipt marker that opens nothing.
 *
 * No soft delete. The table is a record of what was spent, and a hidden row that still exists is a
 * number that disagrees with the export depending on which query you ask — the export being the whole
 * point of the categories. If somebody wants an audit trail of deletions, that is a separate table
 * with a separate reason, not a flag on this one.
 */
export async function deleteExpense(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const g = await gate()
  if (!g) return { ok: false, error: 'Unauthorized' }

  const db = createAdminClient()

  const { data: existing } = await db
    .from('expenses').select('receipt_path').eq('id', id).eq('tenant_id', g.tenantId).maybeSingle()
  if (!existing) return { ok: false, error: 'That expense no longer exists.' }

  const { error } = await db.from('expenses').delete().eq('id', id).eq('tenant_id', g.tenantId)
  if (error) return { ok: false, error: 'That expense could not be deleted.' }

  const path = (existing as { receipt_path?: string | null }).receipt_path
  if (path) await db.storage.from(INVOICE_BUCKET).remove([path])

  return { ok: true }
}

/**
 * A short-lived link to one receipt, or null.
 *
 * Minted per request rather than stored: the bucket is private, and a URL that lived in the page
 * source would outlive the session that was allowed to see it.
 */
export async function receiptUrl(expenseId: string): Promise<string | null> {
  const g = await gate()
  if (!g) return null

  const db = createAdminClient()
  const { data } = await db.from('expenses').select('receipt_path').eq('id', expenseId).eq('tenant_id', g.tenantId).maybeSingle()
  const path = (data as { receipt_path?: string | null } | null)?.receipt_path
  if (!path) return null

  const signed = await db.storage.from(INVOICE_BUCKET).createSignedUrl(path, 60 * 10)
  return signed.data?.signedUrl ?? null
}
