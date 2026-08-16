'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Sheet } from '../form-sheet'
import { Bank, Cash, Card, Check } from './glyphs'

// RECORDING A PAYMENT — the whole point of this screen.
//
// Most businesses here are paid by bank transfer, Zelle, cheque or cash. The money lands in their
// bank, they come in, and they write it down. There is no gateway in this path and nothing is
// charged: this records something that already happened.
//
// ── THE AMOUNT DEFAULTS TO THE BALANCE, AND CAN BE LESS ─────────────────────────────────────────
//
// Most payments settle the invoice, so the field opens on what is still due and "Full balance" puts
// it back. A partial is typed over it, and the sheet says what would be left — because the owner is
// deciding whether this is the end of it, and that question is easier to answer with the remainder in
// front of them than with arithmetic.
//
// Over-paying is allowed. It happens (a rounded transfer, a tip), the ledger stores it, and
// derivePaymentStatus reads anything at or above the total as paid. Refusing it would be this form
// having an opinion about somebody else's bank statement.

const METHODS = [
  { k: 'transfer', label: 'Transfer', glyph: <Bank /> },
  { k: 'zelle', label: 'Zelle', glyph: null },
  { k: 'cash', label: 'Cash', glyph: <Cash /> },
  { k: 'cheque', label: 'Cheque', glyph: null },
  { k: 'card', label: 'Card', glyph: <Card /> },
  { k: 'other', label: 'Other', glyph: null },
] as const

const dollars = (c: number) => (c / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export function RecordPayment({
  invoiceId, who, number, outstandingCents,
}: { invoiceId: string; who: string; number: string; outstandingCents: number }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [amount, setAmount] = useState(dollars(Math.max(0, outstandingCents)))
  const [method, setMethod] = useState<string>('transfer')
  const [ref, setRef] = useState('')

  const cents = Math.round((Number(String(amount).replace(/[^0-9.]/g, '')) || 0) * 100)
  const leftover = outstandingCents - cents

  function close() {
    setOpen(false); setBusy(false); setErr(null)
    setAmount(dollars(Math.max(0, outstandingCents))); setMethod('transfer'); setRef('')
  }

  async function save() {
    if (busy || cents <= 0) return
    setBusy(true); setErr(null)
    try {
      const res = await fetch(`/api/core/documents/invoice/${invoiceId}/payments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          // A payment that settles the invoice is a charge; anything less is a deposit. The ledger
          // keeps both and the balance does not care — but an accountant reading the rows later does.
          kind: cents >= outstandingCents ? 'charge' : 'deposit',
          amountCents: cents,
          method,
          providerRef: ref.trim() || null,
        }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok || j.ok === false) { setErr(j.error || 'That did not save.'); return }
      close()
      router.refresh()
    } catch {
      setErr('That did not save — check your connection.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <button type="button" className="v2-iv-btn" data-p data-touch onClick={() => setOpen(true)}>
        <Check />Record a payment
      </button>

      {open && (
        <Sheet title="Record a payment" busy={busy} onClose={close}>
          <p className="v2-iv-ss">{who} · {number} · ${dollars(outstandingCents)} still due</p>

          <p className="v2-iv-fl">AMOUNT</p>
          <div className="v2-iv-amtrow">
            <input className="v2-iv-fld" value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" disabled={busy} aria-label="Amount" />
            <button type="button" className="v2-iv-full" onClick={() => setAmount(dollars(Math.max(0, outstandingCents)))} disabled={busy}>Full balance</button>
          </div>

          <p className="v2-iv-fl">HOW</p>
          <div className="v2-iv-methods">
            {METHODS.map((m) => (
              <button key={m.k} type="button" className="v2-iv-mth" data-on={method === m.k || undefined} onClick={() => setMethod(m.k)} disabled={busy}>
                {m.glyph}{m.label}
              </button>
            ))}
          </div>

          <p className="v2-iv-fl">REFERENCE — OPTIONAL</p>
          <input className="v2-iv-fld" value={ref} onChange={(e) => setRef(e.target.value)} placeholder="Cheque number, transfer ref…" disabled={busy} aria-label="Reference" />

          {/* WHEN is not a field. The ledger stamps created_at, and a date the owner can type is a
              date that can disagree with the row — backdating is a real need and a separate one,
              because it changes which month a payment lands in. */}

          {/* What would be left. The owner is deciding whether this is the end of it. */}
          {cents > 0 && leftover > 0 && (
            <p className="v2-iv-leftover">${dollars(leftover)} would still be owed after this.</p>
          )}
          {cents > outstandingCents && (
            <p className="v2-iv-leftover">That is ${dollars(cents - outstandingCents)} more than is owed. It will be recorded as paid.</p>
          )}

          {err && <p className="v2-emsg" data-bad>{err}</p>}

          <button type="button" className="v2-iv-save" onClick={() => void save()} disabled={busy || cents <= 0}>
            {busy ? 'Recording…' : `Record $${dollars(cents)}`}
          </button>
        </Sheet>
      )}
    </>
  )
}
