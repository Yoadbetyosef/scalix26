'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Sheet } from '../form-sheet'

// HOW THEY PAY YOU — typed once, here.
//
// It sits on the invoices header rather than in Settings because this is where an owner is when the
// question occurs to them, and a detail buried two screens away is one that stays empty.
//
// ── WHAT IT DOES NOT DO ─────────────────────────────────────────────────────────────────────────
//
// Saving this does NOT change an invoice that has already been issued. The text is snapshotted onto
// each document at issue, so a customer's copy always says where the money was meant to go on the day
// they got it. The sheet says so, because otherwise an owner correcting a typo would reasonably
// assume it had gone out to everybody.

export function PaymentDetails({ instructions, netDays }: { instructions: string | null; netDays: number }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [text, setText] = useState(instructions ?? '')
  const [days, setDays] = useState(String(netDays))
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  function close() { setOpen(false); setText(instructions ?? ''); setDays(String(netDays)); setErr(null) }

  async function save() {
    if (busy) return
    setBusy(true); setErr(null)
    try {
      const res = await fetch('/api/core/invoice-settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paymentInstructions: text.trim() || null, netDays: Number(days) || 0 }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) { setErr(j.detail || j.error || 'That did not save.'); return }
      setOpen(false)
      router.refresh()
    } catch {
      setErr('That did not save — check your connection.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <button type="button" className="v2-hact" data-touch onClick={() => setOpen(true)}>Payment details</button>

      {open && (
        <Sheet title="How they pay you" busy={busy} onClose={close}>
          <p className="v2-iv-ss">Written on every invoice you issue from now on.</p>

          <label className="v2-efield">
            <span>Payment details</span>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={5}
              placeholder={'Zelle: pay@yourbusiness.com\nBank transfer: Chase ••4021, routing 021000021\nCheque payable to Your Business LLC'}
              disabled={busy}
            />
          </label>
          {/* Line breaks survive to the invoice — bank details are a shape as much as a string. */}
          <p className="v2-ehint">Line breaks are kept exactly as you type them.</p>

          <label className="v2-efield">
            <span>Payment due within (days)</span>
            <input type="number" min={0} max={365} value={days} onChange={(e) => setDays(e.target.value)} disabled={busy} />
          </label>
          <p className="v2-ehint">0 means due the day it is issued.</p>

          {/* The thing an owner would otherwise assume wrongly. */}
          <p className="v2-ehint" data-lead>Invoices you have already issued keep the details they were issued with — a customer&apos;s copy never changes after they have it.</p>

          {err && <p className="v2-emsg" data-bad>{err}</p>}

          <div className="v2-eacts">
            <button type="button" className="v2-esec" onClick={close} disabled={busy}>Cancel</button>
            <button type="button" className="v2-epri" onClick={() => void save()} disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
          </div>
        </Sheet>
      )}
    </>
  )
}
