'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Modal } from '@/components/v2/modal'
import { canMemoTransition, isMemoSettled, memoStatusLabel, type MemoStatus } from '@/lib/memos/types'
import type { Memo } from '@/lib/memos/types'

// The four things that happen to a memo, each through /api/memos/[id] which moves the stock in the
// same call. "Returned" and "Sold" ask the one question they need (where to, for how much) and
// nothing else.
export function MemoActions({ memo }: { memo: Memo }) {
  const router = useRouter()
  const [open, setOpen] = useState<MemoStatus | null>(null)
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null)
  const [f, setF] = useState({ note: '', soldPrice: memo.agreedPriceCents != null ? (memo.agreedPriceCents / 100).toFixed(2) : '', toLocation: memo.fromLocation ?? 'showroom', dueOn: '' })
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF((p) => ({ ...p, [k]: e.target.value }))

  const post = async (body: Record<string, unknown>) => {
    setBusy(true); setErr(null)
    try {
      const r = await fetch(`/api/memos/${memo.id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.detail || j.error || 'Failed')
      setOpen(null); router.refresh()
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }

  const go = () => {
    if (!open) return
    const body: Record<string, unknown> = { to: open, note: f.note || null }
    if (open === 'sold') body.soldPriceCents = f.soldPrice.trim() === '' ? null : Math.round((parseFloat(f.soldPrice) || 0) * 100)
    if (open === 'returned') body.toLocation = f.toLocation
    if (open === 'follow_up') body.dueOn = f.dueOn || null
    void post(body)
  }

  if (isMemoSettled(memo.status)) {
    return memo.status === 'sold' && memo.direction === 'in' && !memo.settledAt
      ? <button onClick={() => post({ settle: true })} disabled={busy} className="v2-act" data-solid>Mark supplier paid</button>
      : null
  }

  const targets: MemoStatus[] = (['follow_up', 'pending_decision', 'sold', 'returned'] as MemoStatus[]).filter((t) => canMemoTransition(memo.status, t))
  const label = (t: MemoStatus) => t === 'sold' ? 'Sold' : t === 'returned' ? (memo.direction === 'out' ? 'Returned to stock' : 'Returned to supplier') : t === 'follow_up' ? 'Needs follow-up' : 'Pending decision'

  return (
    <>
      {err && !open && <span className="v2-stat" style={{ ['--chan' as string]: 'var(--v2-red-ink)' }}>{err}</span>}
      {targets.map((t) => (
        <button key={t} onClick={() => { setErr(null); setOpen(t) }} disabled={busy} className="v2-act" data-solid={t === 'sold' || t === 'returned' || undefined}>{label(t)}</button>
      ))}
      <Modal open={open !== null} onClose={() => setOpen(null)} dismissable={!busy} title={open ? label(open) : ''}
        actions={<>
          <button onClick={go} disabled={busy} className="v2-act" data-solid>{busy ? 'Saving…' : 'Confirm'}</button>
          <button onClick={() => setOpen(null)} disabled={busy} className="v2-act">Cancel</button>
        </>}>
        <p className="v2-hint" style={{ marginBottom: 12 }}>
          {open === 'returned' && memo.direction === 'out' && 'The piece comes back into stock and is available again.'}
          {open === 'returned' && memo.direction === 'in' && 'The piece leaves stock — it was never ours — and the memo is closed.'}
          {open === 'sold' && memo.direction === 'out' && 'The piece leaves stock for good. Raise the order and invoice from Orders if you have not already.'}
          {open === 'sold' && memo.direction === 'in' && 'The piece leaves stock and the memo records what is owed to the supplier.'}
          {open === 'follow_up' && 'Nothing moves; the memo is flagged and dated so it is not forgotten.'}
          {open === 'pending_decision' && 'Nothing moves; the customer is deciding.'}
          {' '}Currently: {memoStatusLabel(memo.status, memo.direction, memo.kind)}.
        </p>
        <div className="v2-form" style={{ gridTemplateColumns: '1fr' }}>
          {open === 'sold' && (
            <div className="v2-fld"><label htmlFor="memo-sold">Sold for ({memo.currency.toUpperCase()})</label>
              <input id="memo-sold" value={f.soldPrice} onChange={set('soldPrice')} inputMode="decimal" /></div>
          )}
          {open === 'returned' && memo.direction === 'out' && (
            <div className="v2-fld"><label htmlFor="memo-to">Back into</label>
              <span className="v2-sel"><select id="memo-to" value={f.toLocation} onChange={set('toLocation')}>
                <option value="showroom">Showroom</option><option value="warehouse">Warehouse</option><option value="storage">Storage</option>
              </select></span></div>
          )}
          {open === 'follow_up' && (
            <div className="v2-fld"><label htmlFor="memo-due">Follow up by</label><input id="memo-due" type="date" value={f.dueOn} onChange={set('dueOn')} /></div>
          )}
          <div className="v2-fld"><label htmlFor="memo-note">Note (optional)</label><input id="memo-note" value={f.note} onChange={set('note')} /></div>
        </div>
        {err && <div className="v2-notice" style={{ ['--ghue' as string]: 'var(--v2-t4)', marginTop: 12 }}><p>{err}</p></div>}
      </Modal>
    </>
  )
}
