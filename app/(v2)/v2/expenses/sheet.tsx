'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { CATEGORIES } from '@/lib/expenses/categories'
import { RECEIPT_ACCEPT_ATTR, receiptFileError } from '@/lib/expenses/receipt'
import { downscaleReceipt } from '@/lib/expenses/downscale'
import type { ExpenseRow } from '@/lib/expenses/store'
import { readJson } from '@/lib/http/read-response'
import { Sheet } from '../form-sheet'

// THE EXPENSE FORM — one component, for recording one and for correcting one.
//
// Not two. The fields are identical, the validation is identical, and the only honest difference is
// what the button says and whether Delete is there. Two copies would drift on the parts nobody looks
// at twice — the amount parser's tolerance, the tax field's condition, the date's maximum — and the
// copy that drifts is always the one used less, which is the one a person reaches for when something
// is already wrong.
//
// ── THE PHOTO IS SHRUNK BEFORE IT IS SENT ───────────────────────────────────────────────────────
//
// Not an optimisation. Vercel refuses a request body over ~4.5 MB at the edge, before this route
// exists as far as the application is concerned, and a phone camera produces 3–6 MB per shot — so
// without the redraw the COMMON case fails, and fails as plain text where the client expected JSON.
// See lib/expenses/receipt.ts for the numbers and lib/expenses/downscale.ts for the redraw.
//
// It happens at PICK time rather than at submit, so the person is not waiting on a canvas after they
// have already pressed the button, and so the size check runs against what will actually be sent.
//
// ── THE TAX FIELD IS NOT ALWAYS THERE ───────────────────────────────────────────────────────────
//
// `showsTax` comes from the server. A locksmith in New Jersey sees an amount and nothing else: sales
// tax there is part of what the thing cost and there is nothing to reclaim. A Canadian registrant
// sees both, because for them the tax is an input credit and folding it into the total is wrong twice
// over. See lib/expenses/recoverable-tax.ts for how that is decided without a country field.

export const todayIso = () => new Date().toISOString().slice(0, 10)

const centsToInput = (cents: number) => (cents / 100).toFixed(2)

interface Values { spentOn: string; merchant: string; amount: string; tax: string; category: string; note: string }

/**
 * What is currently attached, and what will therefore be sent.
 *
 * A state rather than a nullable File because "there is no new file" and "take the old one off" are
 * different intents, and a form that cannot tell them apart deletes proof by accident. `removed` is
 * reversible right up until Save — nothing leaves the bucket until the row stops pointing at it.
 */
type ReceiptState =
  | { kind: 'none' }
  | { kind: 'existing'; name: string }
  | { kind: 'removed' }
  | { kind: 'new'; file: File }

const initialValues = (e?: ExpenseRow): Values =>
  e
    ? {
        spentOn: e.spentOn,
        merchant: e.merchant,
        amount: centsToInput(e.amountCents),
        tax: e.taxCents === null ? '' : centsToInput(e.taxCents),
        category: e.category,
        note: e.note ?? '',
      }
    : { spentOn: todayIso(), merchant: '', amount: '', tax: '', category: '', note: '' }

const initialReceipt = (e?: ExpenseRow): ReceiptState =>
  e?.hasReceipt ? { kind: 'existing', name: e.receiptName || 'Receipt' } : { kind: 'none' }

export function ExpenseSheet({
  showsTax, expense, onClose,
}: {
  showsTax: boolean
  /** Absent = recording a new one. Present = correcting that one. */
  expense?: ExpenseRow
  onClose: () => void
}) {
  const router = useRouter()
  const input = useRef<HTMLInputElement>(null)
  const [v, setV] = useState<Values>(() => initialValues(expense))
  const [receipt, setReceipt] = useState<ReceiptState>(() => initialReceipt(expense))
  const [preparing, setPreparing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const editing = !!expense
  const original = initialReceipt(expense)

  const set = (k: keyof Values) => (e: { target: { value: string } }) => setV((p) => ({ ...p, [k]: e.target.value }))

  function close() {
    if (input.current) input.current.value = ''
    onClose()
  }

  async function pick(file: File) {
    setPreparing(true); setErr(null)
    try {
      // Redrawn first, then checked — checking the original would refuse a 6 MB photo that was one
      // canvas away from being a 500 KB one.
      const prepared = await downscaleReceipt(file)
      const problem = receiptFileError(prepared.name, prepared.size)
      if (problem) { setErr(problem); return }
      setReceipt({ kind: 'new', file: prepared })
    } finally {
      setPreparing(false)
      if (input.current) input.current.value = ''
    }
  }

  /** Dropping a NEWLY picked file returns to whatever was there before, never to nothing. */
  const dropPicked = () => setReceipt(original)

  function body(): FormData {
    const b = new FormData()
    b.append('spentOn', v.spentOn)
    b.append('merchant', v.merchant.trim())
    b.append('amount', v.amount)
    // Only when the field was shown. A hidden control must never post a value.
    if (showsTax) b.append('tax', v.tax)
    b.append('category', v.category)
    b.append('note', v.note.trim())
    if (receipt.kind === 'new') b.append('receipt', receipt.file)
    if (editing) {
      b.append('receiptAction', receipt.kind === 'new' ? 'replace' : receipt.kind === 'removed' ? 'remove' : 'keep')
    }
    return b
  }

  async function save() {
    if (busy) return
    setBusy(true); setErr(null)
    try {
      const res = editing
        ? await fetch(`/api/expenses/${expense!.id}`, { method: 'PATCH', body: body() })
        : await fetch('/api/expenses', { method: 'POST', body: body() })
      // readJson, because an over-the-limit body is refused by the edge with plain text and res.json()
      // would throw a parse error over the real one.
      await readJson<{ ok: true }>(res, editing ? 'That change could not be saved.' : 'That expense could not be saved.')
      close()
      router.refresh()
    } catch (e) {
      setErr((e as Error).message || 'That could not be saved.')
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    if (busy) return
    setBusy(true); setErr(null)
    try {
      const res = await fetch(`/api/expenses/${expense!.id}`, { method: 'DELETE' })
      await readJson<{ ok: true }>(res, 'That expense could not be deleted.')
      close()
      router.refresh()
    } catch (e) {
      setErr((e as Error).message || 'That expense could not be deleted.')
      setConfirmingDelete(false)
    } finally {
      setBusy(false)
    }
  }

  const disabled = busy || preparing

  return (
    <Sheet title={editing ? 'Edit expense' : 'New expense'} busy={busy} onClose={close}>
      <div className="v2-xrow">
        <label className="v2-efield">
          <span>Date</span>
          <input type="date" value={v.spentOn} onChange={set('spentOn')} max={todayIso()} disabled={disabled} />
        </label>
        <label className="v2-efield">
          <span>Amount</span>
          {/* inputMode decimal, not type=number: a numeric spinner on a phone is the wrong keypad
              and type=number silently discards what it cannot parse rather than saying so. */}
          <input inputMode="decimal" value={v.amount} onChange={set('amount')} placeholder="0.00" disabled={disabled} />
        </label>
      </div>

      {showsTax && (
        <label className="v2-efield">
          <span>GST / HST included</span>
          <input inputMode="decimal" value={v.tax} onChange={set('tax')} placeholder="Leave blank if unsure" disabled={disabled} />
          <i className="v2-xhint">The recoverable part of the total above — your input tax credit.</i>
        </label>
      )}

      <label className="v2-efield">
        <span>Paid to</span>
        <input value={v.merchant} onChange={set('merchant')} placeholder="Shell, Rogers, the landlord…" disabled={disabled} />
      </label>

      <label className="v2-efield">
        <span>Category</span>
        <select value={v.category} onChange={set('category')} disabled={disabled}>
          <option value="">Choose one…</option>
          {CATEGORIES.map((c) => (
            <option key={c.key} value={c.key}>{c.label}{c.hint ? ` — ${c.hint}` : ''}</option>
          ))}
        </select>
        {/* THERE IS NO "OTHER", and this says so rather than leaving somebody hunting for it. A
            receipt that fits nothing means the list is missing something, and the note is where
            that gets recorded until it does. */}
        <i className="v2-xhint">Nothing fits? Put what it was in the note and tell us — the list is missing something.</i>
      </label>

      <label className="v2-efield">
        <span>Note</span>
        <textarea value={v.note} onChange={set('note')} rows={2} placeholder="Optional" disabled={disabled} />
      </label>

      <input
        ref={input}
        type="file"
        accept={RECEIPT_ACCEPT_ATTR}
        className="v2-hidden-file"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) void pick(f) }}
        disabled={disabled}
      />
      <div className="v2-xreceipt">
        <button type="button" className="v2-xattach" onClick={() => input.current?.click()} disabled={disabled}>
          <Clip />{preparing ? 'Preparing…' : receipt.kind === 'none' || receipt.kind === 'removed' ? 'Attach a receipt' : 'Replace photo'}
        </button>

        {receipt.kind === 'new' && (
          <span className="v2-xfile">
            {receipt.file.name} · {(receipt.file.size / 1024).toFixed(0)} KB
            <button type="button" onClick={dropPicked} disabled={disabled} aria-label="Discard this photo">×</button>
          </span>
        )}
        {receipt.kind === 'existing' && (
          <span className="v2-xfile">
            {receipt.name}
            <button type="button" onClick={() => setReceipt({ kind: 'removed' })} disabled={disabled} aria-label="Remove the receipt">×</button>
          </span>
        )}
        {receipt.kind === 'removed' && (
          <span className="v2-xfile" data-warn>
            Photo will be removed
            <button type="button" className="v2-xundo" onClick={() => setReceipt(original)} disabled={disabled}>Undo</button>
          </span>
        )}
      </div>

      {err && <p className="v2-emsg" data-bad>{err}</p>}
      {/* What the receipt is FOR. Nothing reads it — this is proof for the day somebody asks, and
          saying so stops it looking like a feature that failed to do anything. */}
      <p className="v2-ehint">The photo is kept as proof. Nothing reads it — it is there for when your accountant asks.</p>

      {/* Delete is on its OWN ROW, above the pair, and is a text button rather than a third block of
          the same size. It is not the other option in the same choice — it is a different and
          irreversible one, and a red rectangle the same shape as Cancel, one thumb-width from it, is
          a mis-tap that cannot be undone.
          Two presses rather than a browser confirm(): confirm() is suppressed in some mobile contexts
          and, where it does appear, looks like it came from a different application. */}
      {editing && (
        <div className="v2-xdelrow">
          {confirmingDelete ? (
            <>
              <span className="v2-xdel-ask">Delete this expense? The photo goes with it.</span>
              <button type="button" className="v2-xdel-yes" onClick={() => void remove()} disabled={busy}>
                {busy ? 'Deleting…' : 'Yes, delete'}
              </button>
              <button type="button" className="v2-xdel-no" onClick={() => setConfirmingDelete(false)} disabled={busy}>Keep it</button>
            </>
          ) : (
            <button type="button" className="v2-xdel" onClick={() => setConfirmingDelete(true)} disabled={disabled}>Delete this expense</button>
          )}
        </div>
      )}

      <div className="v2-eacts">
        <button type="button" className="v2-esec" onClick={close} disabled={busy}>Cancel</button>
        <button type="button" className="v2-epri" onClick={() => void save()} disabled={disabled}>
          {busy ? 'Saving…' : editing ? 'Save changes' : 'Save expense'}
        </button>
      </div>
    </Sheet>
  )
}

// Sized in the markup as well as in CSS — see header-glyph.test.ts for what an unsized viewBox does
// inside a flex button.
export const Plus = () => (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
    <path d="M12 5v14M5 12h14" />
  </svg>
)

const Clip = () => (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M21.4 11.05 12.25 20.2a5.5 5.5 0 0 1-7.78-7.78l9.19-9.19a3.67 3.67 0 1 1 5.18 5.18l-9.2 9.2a1.83 1.83 0 0 1-2.59-2.6l8.49-8.48" />
  </svg>
)
