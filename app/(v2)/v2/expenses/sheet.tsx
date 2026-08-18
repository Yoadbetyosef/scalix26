'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { CATEGORIES } from '@/lib/expenses/categories'
import { RECEIPT_ACCEPT_ATTR, canBeRead, receiptFileError } from '@/lib/expenses/receipt'
import { prepareReceipt } from '@/lib/expenses/downscale'
import type { ReceiptReading } from '@/lib/expenses/extract'
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
// ── THE SHEET IS NEVER BLOCKED WHILE THE PHOTO IS BEING READ ────────────────────────────────────
//
// This is the decision that makes a five-second read acceptable. The fields stay live from the
// moment the sheet opens: somebody who knows the amount can type it and be gone before the model
// answers, and somebody who doesn't can watch it fill in. A spinner over a form is the same wait
// spent worse.
//
// It is also the correct merge rule, not just the pleasant one. `touched` records every field the
// person has put a hand on, and the reading fills ONLY the ones they have not. A read that arrives
// four seconds late must never overwrite what somebody just typed — that is the one failure that
// would make the feature untrustworthy rather than merely slow.
//
// ── THE PHOTO IS SHRUNK BEFORE IT IS SENT, TWICE ────────────────────────────────────────────────
//
// Not an optimisation. Vercel refuses a request body over ~4.5 MB at the edge, before the route
// exists as far as the application is concerned, and a phone camera produces 3–6 MB per shot — so
// without the redraw the COMMON case fails, and fails as plain text where the client expected JSON.
//
// Two copies come out of one decode: 2000px to be stored as proof, 1600px for the model. The small
// one is the one a person waits on, so it is the one made small. See lib/expenses/downscale.ts.
//
// ── AND THE TAX FIELD IS NOT ALWAYS THERE ───────────────────────────────────────────────────────
//
// `showsTax` comes from the server. A locksmith in New Jersey sees an amount and nothing else: sales
// tax there is part of what the thing cost and there is nothing to reclaim. A Canadian registrant
// sees both, because for them the tax is an input credit and folding it into the total is wrong twice
// over. See lib/expenses/recoverable-tax.ts for how that is decided without a country field.

export const todayIso = () => new Date().toISOString().slice(0, 10)

const centsToInput = (cents: number) => (cents / 100).toFixed(2)

/**
 * How long the sheet waits for a reading before giving up and being a form.
 *
 * The route's own ceiling is 30s. This is shorter on purpose: the server may as well finish and bill
 * for what it did, but a person holding a phone has already decided by twenty seconds, and the thing
 * they decided is that this is broken. Giving up here costs one read; not giving up costs the tap.
 */
const READ_TIMEOUT_MS = 20_000

type FieldKey = 'spentOn' | 'merchant' | 'amount' | 'tax' | 'category' | 'note'
type Values = Record<FieldKey, string>

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

type ReadState = 'idle' | 'working' | 'done' | 'failed'

const initialValues = (e?: ExpenseRow, expectPhoto?: boolean): Values =>
  e
    ? {
        spentOn: e.spentOn,
        merchant: e.merchant,
        amount: centsToInput(e.amountCents),
        tax: e.taxCents === null ? '' : centsToInput(e.taxCents),
        category: e.category,
        note: e.note ?? '',
      }
    : {
        // BLANK ASKS, TODAY ASSERTS. Today is a reasonable guess when nobody has looked at the paper,
        // which is the typed-in path. The moment a photograph is coming it stops being a guess and
        // becomes a claim — and "I entered an old receipt and it silently dated it today" was the
        // first real complaint this screen produced. So: empty until the receipt says otherwise.
        spentOn: expectPhoto ? '' : todayIso(),
        merchant: '', amount: '', tax: '', category: '', note: '',
      }

const initialReceipt = (e?: ExpenseRow): ReceiptState =>
  e?.hasReceipt ? { kind: 'existing', name: e.receiptName || 'Receipt' } : { kind: 'none' }

export function ExpenseSheet({
  showsTax, expense, initialFile, initialReading, prepared, expectPhoto, onClose,
}: {
  showsTax: boolean
  /** Absent = recording a new one. Present = correcting that one. */
  expense?: ExpenseRow
  /** A photograph already taken, arriving with the sheet. Read immediately. */
  initialFile?: File | null
  /**
   * A reading the MONEY-OUT DOOR already paid for, arriving with the file.
   *
   * When it is here the sheet does not read again — the same page going to the model twice is money
   * spent to learn what is already on screen. The file still goes through prepareReceipt, because
   * that produces the copy that gets STORED and that step is not the read.
   *
   * The door is the only caller that has one: it has to read a document before it can know whether
   * the document is an expense at all, and this is what it does with the answer when it is.
   */
  initialReading?: ReceiptReading | null
  /**
   * The door has already run prepareReceipt on this file, and the hash it computed of what it sent
   * to the model. Re-encoding the same photograph a second time would lose detail for nothing and
   * would produce a different hash from the one the duplicate check is about to store.
   */
  prepared?: { already: true; fileHash: string | null } | null
  /** The camera was opened along with this sheet — so a date is coming, or is being declined. */
  expectPhoto?: boolean
  onClose: () => void
}) {
  const router = useRouter()
  const input = useRef<HTMLInputElement>(null)
  const [v, setV] = useState<Values>(() => initialValues(expense, expectPhoto))
  const [receipt, setReceipt] = useState<ReceiptState>(() => initialReceipt(expense))
  const [preparing, setPreparing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const [readState, setReadState] = useState<ReadState>('idle')
  const [readNote, setReadNote] = useState<string | null>(null)
  const [datePrinted, setDatePrinted] = useState<string | null>(null)
  const [fromPhoto, setFromPhoto] = useState<Set<FieldKey>>(() => new Set())

  // A ref, not state: nothing renders from it, and it must be current the instant a keystroke lands
  // rather than after the next paint — a reading that returns between the two would overwrite.
  const touched = useRef<Set<FieldKey>>(new Set())
  const editing = !!expense
  const original = initialReceipt(expense)

  // ONE handler for every field, keyed off the control's own `name`, rather than a set(k) factory.
  // A factory is invoked during render and the closure it returns touches `touched.current`, which is
  // a ref read the linter cannot prove happens later — and it is right to be strict about it. One
  // handler defined and never called during render says the same thing with no argument.
  function onField(e: { target: { name: string; value: string } }) {
    const k = e.target.name as FieldKey
    touched.current.add(k)
    // Once a person has edited a field it is theirs, and the marker saying where it came from is a
    // lie. Removed on the first keystroke, not on blur.
    setFromPhoto((p) => { if (!p.has(k)) return p; const n = new Set(p); n.delete(k); return n })
    setV((p) => ({ ...p, [k]: e.target.value }))
  }

  function close() {
    if (input.current) input.current.value = ''
    onClose()
  }

  /** Fill what the person has not touched, and say so where it came from. */
  function applyReading(r: ReceiptReading | null) {
    if (!r) { setReadState('failed'); setReadNote(FAILED); return }

    setDatePrinted(r.datePrinted)

    const filled = new Set<FieldKey>()
    const put = (k: FieldKey, value: string | null) => {
      if (!value || touched.current.has(k)) return
      filled.add(k)
      setV((p) => ({ ...p, [k]: value }))
    }

    put('merchant', r.merchant)
    put('amount', r.amountCents === null ? null : centsToInput(r.amountCents))
    // Only into a field that exists. A hidden control must never carry a value.
    if (showsTax) put('tax', r.taxCents === null ? null : centsToInput(r.taxCents))
    put('spentOn', r.spentOn)
    put('category', r.category)

    setFromPhoto(filled)
    setReadState('done')
    // Silence when it worked — the filled fields say so themselves, and a banner over a form that is
    // already correct is one more thing to read. A sentence only when there is nothing to show for
    // the wait, and it says what to do rather than what went wrong.
    setReadNote(filled.size === 0 ? EMPTY_NOTE[r.readable] : null)
  }

  async function readPhoto(file: File) {
    // A HEIC that survived the redraw — Chrome cannot decode one. Not an error and not worth a round
    // trip: the form is open and typing works.
    if (!canBeRead(file.name)) { setReadState('failed'); setReadNote(FAILED); return }

    setReadState('working'); setReadNote(null)
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), READ_TIMEOUT_MS)
    try {
      const body = new FormData()
      body.append('receipt', file)
      const res = await fetch('/api/expenses/read', { method: 'POST', body, signal: ctrl.signal })
      const data = await readJson<{ reading: ReceiptReading | null }>(res, FAILED)
      applyReading(data.reading)
    } catch {
      // Abort, network, a 500, an edge refusal — all the same from here. The form still works, so
      // this is a note rather than an error, and it never touches `err`, which is about saving.
      setReadState('failed'); setReadNote(FAILED)
    } finally {
      clearTimeout(timer)
    }
  }

  async function accept(file: File) {
    setPreparing(true); setErr(null)
    try {
      // Redrawn first, then checked — checking the original would refuse a 6 MB photo that was one
      // canvas away from being a 500 KB one.
      const ready = prepared?.already ? { stored: file, read: null } : await prepareReceipt(file)
      const problem = receiptFileError(ready.stored.name, ready.stored.size)
      if (problem) { setErr(problem); return }
      setReceipt({ kind: 'new', file: ready.stored })

      // Reading happens on a NEW expense only. On an edit the fields are already right and were
      // already checked by a person; a replacement photo is a replacement photo, and quietly
      // rewriting six fields because somebody re-photographed a receipt is the overwrite this whole
      // component is built to avoid.
      // Already read at the door — apply it rather than paying for the same page twice.
      if (editing) return
      if (initialReading !== undefined) applyReading(initialReading)
      else void readPhoto(ready.read ?? ready.stored)
    } finally {
      setPreparing(false)
      if (input.current) input.current.value = ''
    }
  }

  // The photograph that came with the sheet, from the Add button's camera.
  const started = useRef(false)
  useEffect(() => {
    if (started.current || !initialFile) return
    started.current = true
    void accept(initialFile)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialFile])

  // The camera was dismissed with nothing taken. No photograph is coming, so today stops being a
  // claim about a receipt and goes back to being a reasonable guess — which is what the typed-in path
  // has always had. Guarded on `initialFile` so a photograph that WAS taken and simply had no legible
  // date never gets today filled in behind it.
  useEffect(() => {
    if (editing || expectPhoto || initialFile) return
    if (touched.current.has('spentOn')) return
    setV((p) => (p.spentOn ? p : { ...p, spentOn: todayIso() }))
  }, [editing, expectPhoto, initialFile])

  /** Dropping a NEWLY picked file returns to whatever was there before, never to nothing. */
  const dropPicked = () => {
    setReceipt(original)
    setReadState('idle'); setReadNote(null); setDatePrinted(null); setFromPhoto(new Set())
  }

  function body(): FormData {
    const b = new FormData()
    b.append('spentOn', v.spentOn)
    b.append('merchant', v.merchant.trim())
    b.append('amount', v.amount)
    if (showsTax) b.append('tax', v.tax)
    b.append('category', v.category)
    b.append('note', v.note.trim())
    if (receipt.kind === 'new') b.append('receipt', receipt.file)
    // The hash the DOOR computed of the bytes it read, carried through so the next upload of the
    // same file can say "you have put this in before". Only ever a warning and only ever within one
    // tenant, which is why a client carrying it is acceptable: the worst a wrong value can do is miss
    // a warning or raise a spurious one, and neither changes a number.
    if (!editing && prepared?.fileHash) b.append('fileHash', prepared.fileHash)
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

  // NOT disabled while reading. Only a save in flight and a canvas mid-redraw stop the fields, and the
  // redraw is a few hundred milliseconds at pick time.
  const disabled = busy || preparing

  return (
    <Sheet title={editing ? 'Edit expense' : 'New expense'} busy={busy} onClose={close}>
      {readState === 'working' && (
        <p className="v2-xreading"><Spinner />Reading the receipt — type anything you already know.</p>
      )}
      {readNote && <p className="v2-xreading" data-quiet>{readNote}</p>}

      <div className="v2-xrow">
        <label className="v2-efield">
          <span>Date{fromPhoto.has('spentOn') && <i className="v2-xtag">from the photo</i>}</span>
          <input type="date" name="spentOn" value={v.spentOn} onChange={onField} max={todayIso()} disabled={disabled} />
          {/* The date AS PRINTED, beside the field. A purely numeric date is ambiguous between US and
              UK order and no prompt fixes that — but a person who can see "03/04/2026" next to the
              field catches a swapped day and month in a glance, which is the only place it can be
              caught before it is a wrong month in a tax return. */}
          {datePrinted && <i className="v2-xhint">The receipt says {datePrinted}</i>}
        </label>
        <label className="v2-efield">
          <span>Amount{fromPhoto.has('amount') && <i className="v2-xtag">from the photo</i>}</span>
          {/* inputMode decimal, not type=number: a numeric spinner on a phone is the wrong keypad
              and type=number silently discards what it cannot parse rather than saying so. */}
          <input inputMode="decimal" name="amount" value={v.amount} onChange={onField} placeholder="0.00" disabled={disabled} />
        </label>
      </div>

      {showsTax && (
        <label className="v2-efield">
          <span>GST / HST included{fromPhoto.has('tax') && <i className="v2-xtag">from the photo</i>}</span>
          <input inputMode="decimal" name="tax" value={v.tax} onChange={onField} placeholder="Leave blank if unsure" disabled={disabled} />
          <i className="v2-xhint">The recoverable part of the total above — your input tax credit.</i>
        </label>
      )}

      <label className="v2-efield">
        <span>Paid to{fromPhoto.has('merchant') && <i className="v2-xtag">from the photo</i>}</span>
        <input name="merchant" value={v.merchant} onChange={onField} placeholder="Shell, Rogers, the landlord…" disabled={disabled} />
      </label>

      <label className="v2-efield">
        <span>Category{fromPhoto.has('category') && <i className="v2-xtag">from the photo</i>}</span>
        <select name="category" value={v.category} onChange={onField} disabled={disabled}>
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
        <textarea name="note" value={v.note} onChange={onField} rows={2} placeholder="Optional" disabled={disabled} />
      </label>

      <input
        ref={input}
        type="file"
        accept={RECEIPT_ACCEPT_ATTR}
        className="v2-hidden-file"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) void accept(f) }}
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
      {/* What the photo is for. It is read ONCE, to fill this form, and then it is proof — and saying
          so is what stops "nothing reads it" being replaced by a vaguer belief that something does. */}
      <p className="v2-ehint">
        {editing
          ? 'The photo is kept as proof — it is there for when your accountant asks.'
          : 'The photo fills this form in and is then kept as proof. Check the numbers against the paper before you save.'}
      </p>

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

/**
 * What to say when the wait produced nothing.
 *
 * All three end the same way — fill it in, it still saves — because the receipt is proof whether or
 * not anything could read it, and a person who has just photographed one should not be left thinking
 * the photograph was wasted. They differ at the front because "the print has faded" and "that is not
 * a receipt" are different problems with different next actions, and calling a mis-tap a failed read
 * makes the software look broken when the person simply photographed the wrong thing.
 */
const EMPTY_NOTE: Record<ReceiptReading['readable'], string> = {
  receipt: 'Could not make out the details on that one — fill them in and it still saves as proof.',
  unreadable: 'That print is too faint to read — fill the fields in and it still saves as proof.',
  not_a_receipt: 'That does not look like a receipt. Fill the fields in, or attach a different photo.',
}

const FAILED = 'Could not read that one just now — fill the fields in and it still saves as proof.'

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

const Spinner = () => (
  <svg className="v2-xspin" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden>
    <path d="M12 3a9 9 0 0 1 9 9" />
  </svg>
)
