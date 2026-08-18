'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Sheet } from '../../form-sheet'
import { CATEGORIES } from '@/lib/expenses/categories'

// THE ONE QUESTION AN OWNER EVER ANSWERS.
//
// "Are these products you sell, or is this an expense?" — asked once, in their words, and only in the
// one state where it is a real question: a bill with lines on it and NOTHING matched. See
// OUTSTANDING.md §10b.
//
// ── WHY IT IS NOT A DISMISSIBLE FLAG ────────────────────────────────────────────────────────────
//
// There is nothing stored anywhere recording that this was asked or answered, and that is deliberate.
// The question is a function of the state: while nothing on the bill is matched, it is still true. A
// row remembering "they told us these are products" while the screen shows nothing matched would be
// storing an answer that contradicts what is in front of the person — and it would need a migration
// to hold a fact that is already derivable.
//
// So both answers are ACTIONS rather than replies. "They are products" is answered by creating them
// or matching them, which is what the rest of the screen is for, and the question disappears on its
// own the moment one line matches. "It is an expense" is this control.
//
// ── AND THE CATEGORY IS THE ONLY THING ASKED FOR ────────────────────────────────────────────────
//
// Everything else was read off the document when it arrived. The category is an accounting judgement
// written nowhere on the paper, and it is the field the export groups by — so it is the one field a
// guess would turn into a wrong line in somebody's return.

export function NotStock({ shipmentId, supplier, amount }: {
  shipmentId: string
  supplier: string
  /** Preformatted by the server, so there is one money formatter on this screen. */
  amount: string
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [category, setCategory] = useState('')

  async function move() {
    if (busy || !category) return
    setBusy(true); setErr(null)
    try {
      const res = await fetch('/api/money-out/reclassify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shipmentId, category }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) { setErr(j.error || 'That bill could not be moved.'); return }
      // It is not a bill any more, so there is nothing here to come back to.
      router.push('/v2/expenses')
    } catch {
      setErr('That bill could not be moved — check your connection.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <button type="button" className="v2-bl-fix" onClick={() => setOpen(true)}>This is an expense</button>

      {open && (
        <Sheet title="Move this to Money out" busy={busy} onClose={() => { setOpen(false); setErr(null) }}>
          <p className="v2-iv-ss">
            {`${supplier} · ${amount}. It stays as a record of money going out, with the document attached — `}
            {`it just stops being stock, so nothing on it lands on a product cost.`}
          </p>

          <label className="v2-efield">
            <span>What kind of expense is it?</span>
            <select value={category} onChange={(e) => setCategory(e.target.value)} disabled={busy}>
              <option value="">Pick one…</option>
              {CATEGORIES.map((c) => (
                <option key={c.key} value={c.key}>{c.label}</option>
              ))}
            </select>
            <span className="v2-xhint">
              Everything else was already read off the document. This is the one thing it does not say,
              and it is what the year-end export groups by.
            </span>
          </label>

          {err && <p className="v2-emsg" data-bad>{err}</p>}

          <div className="v2-eacts">
            <button type="button" className="v2-esec" onClick={() => { setOpen(false); setErr(null) }} disabled={busy}>Cancel</button>
            <button type="button" className="v2-epri" onClick={() => void move()} disabled={busy || !category}>
              {busy ? 'Moving…' : 'Move to Money out'}
            </button>
          </div>
        </Sheet>
      )}
    </>
  )
}
