'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Modal } from '@/components/v2/modal'
import { useConfirm } from '@/components/v2/confirm'
import {
  ORDER_PAYMENT_METHODS, PAYMENT_METHOD_LABELS,
  type OrderPayment, type OrderPaymentKind, type OrderPaymentMethod, type OrderTotals,
} from '@/lib/orders/payment-types'

// Money received against the order: the running totals, every payment with how and when it arrived,
// and the one dialog that records the next one.
//
// The dialog does not ask "is this the deposit or the balance?" as a first question — the running
// balance already knows. The first payment on an order is offered as a deposit; anything after that
// is a payment, and the amount field opens on the balance due so paying in full is one tap.

const money = (cents: number, cur: string) =>
  new Intl.NumberFormat(undefined, { style: 'currency', currency: cur.toUpperCase(), maximumFractionDigits: 2 }).format(cents / 100)

const STATUS_LABEL: Record<OrderTotals['status'], string> = {
  unpaid: 'Nothing received', partial: 'Partly paid', paid: 'Paid in full', overpaid: 'Overpaid — refund due',
}
const STATUS_HUE: Record<OrderTotals['status'], string> = {
  unpaid: 'var(--v2-mute)', partial: 'var(--v2-t3)', paid: 'var(--v2-t2)', overpaid: 'var(--v2-t4)',
}

export function PaymentsPanel({ orderId, currency, totals, payments, canRecord }: {
  orderId: string; currency: string; totals: OrderTotals; payments: OrderPayment[]
  /** False on a cancelled order — there is nothing to pay for. */
  canRecord: boolean
}) {
  const router = useRouter()
  const { ask, dialog } = useConfirm()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)

  const firstPayment = payments.length === 0
  const defaultKind: OrderPaymentKind = firstPayment ? 'deposit' : 'payment'
  const [f, setF] = useState({
    kind: defaultKind as OrderPaymentKind,
    amount: '',
    method: 'card' as OrderPaymentMethod,
    reference: '',
    paidOn: new Date().toISOString().slice(0, 10),
    note: '',
  })
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setF((p) => ({ ...p, [k]: e.target.value }))

  const openDialog = () => {
    setF((p) => ({
      ...p,
      kind: firstPayment ? 'deposit' : 'payment',
      // The balance, pre-filled, so "paid in full" is Save with nothing typed. A deposit is a
      // smaller number she types over it.
      amount: totals.dueCents > 0 && !firstPayment ? (totals.dueCents / 100).toFixed(2) : '',
      paidOn: new Date().toISOString().slice(0, 10),
    }))
    setErr(null); setOpen(true)
  }

  const save = async () => {
    const cents = Math.round((parseFloat(f.amount) || 0) * 100)
    if (!cents) { setErr('Enter an amount.'); return }
    setBusy(true); setErr(null)
    try {
      const r = await fetch(`/api/orders/${orderId}/payments`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind: f.kind, amountCents: cents, method: f.method,
          reference: f.reference.trim() || null, note: f.note.trim() || null, paidOn: f.paidOn || null,
          // One key per dialog submission: a double-tap on Save records one payment, not two.
          idempotencyKey: `ui:${orderId}:${f.paidOn}:${cents}:${f.method}:${f.reference.trim()}`,
        }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.detail || j.error || 'Could not record the payment.')
      if (j.degraded) setNote(j.degraded)
      setOpen(false); setF((p) => ({ ...p, amount: '', reference: '', note: '' }))
      router.refresh()
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }

  const remove = async (p: OrderPayment) => {
    if (!(await ask({
      title: 'Remove this payment?',
      body: `${money(Math.abs(p.amountCents), currency)} recorded on ${p.paidOn} will be taken off the order. The removal stays on the timeline.`,
      confirmLabel: 'Remove', danger: true,
    }))) return
    setBusy(true); setErr(null)
    try {
      const r = await fetch(`/api/orders/${orderId}/payments/${p.id}`, { method: 'DELETE' })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.error || 'Could not remove the payment.')
      router.refresh()
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }

  return (
    <section>
      <div className="v2-head" style={{ marginBottom: 12 }}>
        <p className="v2-kick"><i />Payments · {payments.length}</p>
        <s />
        <span className="v2-stat" style={{ ['--chan' as string]: STATUS_HUE[totals.status] }}>{STATUS_LABEL[totals.status]}</span>
        {canRecord && (
          <button type="button" onClick={openDialog} className="v2-act" data-solid={totals.dueCents > 0 || undefined}>
            {firstPayment ? 'Record deposit' : totals.dueCents > 0 ? 'Record payment' : 'Record refund'}
          </button>
        )}
      </div>

      {/* The five numbers the invoice prints, in the order it prints them. */}
      <dl className="v2-tot">
        <div><dt>Subtotal</dt><dd>{money(totals.subtotalCents, currency)}</dd></div>
        {totals.taxCents > 0 && <div><dt>Tax</dt><dd>{money(totals.taxCents, currency)}</dd></div>}
        <div><dt>Total</dt><dd>{money(totals.totalCents, currency)}</dd></div>
        <div><dt>Paid</dt><dd>{money(totals.paidCents, currency)}</dd></div>
        <div><dt>Balance due</dt><dd>{money(totals.dueCents, currency)}</dd></div>
      </dl>

      {payments.length > 0 && (
        <div className="overflow-x-auto" style={{ marginTop: 12 }}>
          <table className="v2-tbl">
            <thead><tr><th>Date</th><th>What</th><th>Method</th><th>Reference</th><th>Amount</th><th /></tr></thead>
            <tbody>
              {payments.map((p) => (
                <tr key={p.id}>
                  <td style={{ whiteSpace: 'nowrap' }}>{p.paidOn}</td>
                  <td>
                    {p.kind === 'deposit' ? 'Deposit' : p.kind === 'refund' ? 'Refund' : 'Payment'}
                    {p.note && <div className="v2-hint">{p.note}</div>}
                  </td>
                  <td>{p.method ? PAYMENT_METHOD_LABELS[p.method] : '—'}</td>
                  <td style={{ fontFamily: 'var(--v2-mono)', fontSize: 12 }}>{p.reference ?? '—'}</td>
                  <td style={{ fontVariantNumeric: 'tabular-nums', color: p.amountCents < 0 ? 'var(--v2-red-ink)' : 'var(--v2-ink)' }}>
                    {p.amountCents < 0 ? '−' : ''}{money(Math.abs(p.amountCents), currency)}
                  </td>
                  <td>
                    {canRecord && (
                      <button type="button" onClick={() => remove(p)} disabled={busy} className="v2-act" data-danger style={{ fontSize: 12 }}>Remove</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {note && <div className="v2-notice" style={{ ['--ghue' as string]: 'var(--v2-t3)', marginTop: 12 }}><p>{note}</p></div>}
      {err && !open && <div className="v2-notice" style={{ ['--ghue' as string]: 'var(--v2-t4)', marginTop: 12 }}><p>{err}</p></div>}

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        dismissable={!busy}
        title={f.kind === 'deposit' ? 'Record deposit' : f.kind === 'refund' ? 'Record refund' : 'Record payment'}
        actions={
          <>
            <button onClick={save} disabled={busy} className="v2-act" data-solid>{busy ? 'Saving…' : 'Save payment'}</button>
            <button onClick={() => setOpen(false)} disabled={busy} className="v2-act">Cancel</button>
          </>
        }
      >
        <p className="v2-hint" style={{ marginBottom: 14 }}>
          Balance due {money(totals.dueCents, currency)} of {money(totals.totalCents, currency)}. Card numbers are never stored — only the receipt or reference.
        </p>
        <div className="v2-form" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
          <div className="v2-fld"><label htmlFor="pay-kind">This is a</label>
            <span className="v2-sel">
              <select id="pay-kind" value={f.kind} onChange={set('kind')}>
                <option value="deposit">Deposit</option>
                <option value="payment">Payment (partial or final)</option>
                <option value="refund">Refund</option>
              </select>
            </span>
          </div>
          <div className="v2-fld"><label htmlFor="pay-amount">Amount ({currency.toUpperCase()})</label>
            <input id="pay-amount" value={f.amount} onChange={set('amount')} inputMode="decimal" placeholder="0.00" autoFocus /></div>
          <div className="v2-fld"><label htmlFor="pay-method">Method</label>
            <span className="v2-sel">
              <select id="pay-method" value={f.method} onChange={set('method')}>
                {ORDER_PAYMENT_METHODS.map((m) => <option key={m} value={m}>{PAYMENT_METHOD_LABELS[m]}</option>)}
              </select>
            </span>
          </div>
          <div className="v2-fld"><label htmlFor="pay-date">Received on</label>
            <input id="pay-date" type="date" value={f.paidOn} onChange={set('paidOn')} /></div>
          <div className="v2-fld"><label htmlFor="pay-ref">
            {f.method === 'cheque' ? 'Cheque number' : f.method === 'card' ? 'Receipt / transaction id' : f.method === 'cash' ? 'Receipt number (optional)' : 'Reference (optional)'}
          </label>
            <input id="pay-ref" value={f.reference} onChange={set('reference')} /></div>
          <div className="v2-fld" style={{ gridColumn: '1 / -1' }}><label htmlFor="pay-note">Note (optional)</label>
            <input id="pay-note" value={f.note} onChange={set('note')} placeholder="e.g. paid at pickup" /></div>
        </div>
        {err && <div className="v2-notice" style={{ ['--ghue' as string]: 'var(--v2-t4)', marginTop: 14 }}><p>{err}</p></div>}
      </Modal>
      {dialog}
    </section>
  )
}
