'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  ORDER_STAGES, STAGE_LABELS, REOPEN_TARGET, canManualTransition, canReopen, isLiveStage, type OrderStage,
} from '@/lib/orders/stages'
import { useConfirm } from '@/components/v2/confirm'
import { Modal } from '@/components/v2/modal'

// Moving an order between stages by hand — the same transition the board's drag makes, through the
// same route, so the two cannot disagree.
//
// ── ONE PICKER, NOT FOURTEEN BUTTONS ────────────────────────────────────────────────────────────
//
// Now that a live job may go to any live stage (lib/orders/stages.ts), listing every target as its
// own button is a wall. The three things people actually press are pinned as buttons: the next
// step forward, Close – no sale, and (for a closed order) Reopen. Everything else is behind "Move
// to…", which opens a small dialog with the stage list and a line for WHY — the reason lands on the
// timeline beside from, to and who, which is the history the business asked for.

/** The ordinary next step, offered as a one-tap button. Null where there is no obvious one. */
const NEXT: Partial<Record<OrderStage, OrderStage>> = {
  new: 'in_process', in_process: 'production', factory_approved: 'production', customer_approved: 'production',
  production: 'ready', ready: 'delivered', delivered: 'completed',
}

export function StageControl({ orderId, stage }: { orderId: string; stage: OrderStage }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [target, setTarget] = useState<OrderStage | ''>('')
  const [note, setNote] = useState('')
  const { ask, dialog } = useConfirm()

  const targets = ORDER_STAGES.filter((s) => canManualTransition(stage, s))
  const next = NEXT[stage] && canManualTransition(stage, NEXT[stage]!) ? NEXT[stage]! : null
  const reopenTo = canReopen(stage) ? REOPEN_TARGET[stage]! : null

  const move = async (to: OrderStage, why?: string) => {
    // The two endings that cannot be undone confirm. Closing as no-sale does not — it is the
    // ordinary end of an estimate, thirty times a day, and it comes back from the same button.
    if (to === 'cancelled' && !(await ask({
      title: 'Cancel this order?',
      body: 'Nothing is deleted — the order, its line items and its history all stay. What cannot be undone is the stage: nothing moves out of a cancelled order. If the customer simply did not buy, close it as no sale instead, which can be reopened.',
      confirmLabel: 'Cancel the order', danger: true,
    }))) return
    if ((to === 'finished' || to === 'completed') && !(await ask({
      title: to === 'finished' ? 'Mark this order finished?' : 'Mark this order completed?',
      body: 'It becomes a closed order. It can be reopened from the order page if something comes back, and invoicing is separate — a closed order can still be invoiced.',
      confirmLabel: to === 'finished' ? 'Mark finished' : 'Mark completed',
    }))) return
    if (reopenTo && to === reopenTo && !(await ask({
      title: 'Reopen this order?',
      body: `It goes back to ${STAGE_LABELS[to]} and counts as open again. The closing stays on the timeline.`,
      confirmLabel: 'Reopen',
    }))) return
    setBusy(true); setErr(null)
    try {
      const r = await fetch(`/api/orders/${orderId}/stage`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ toStage: to, note: (why ?? '').trim() || null }),
      })
      if (!r.ok) throw new Error((await r.json()).error || 'Failed')
      setOpen(false); setTarget(''); setNote('')
      router.refresh()
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }

  if (targets.length === 0) return null
  const label = (t: OrderStage) =>
    t === 'cancelled' ? 'Cancel order' : t === 'finished' ? 'Mark finished' : t === 'closed_no_sale' ? 'Close – no sale'
      : reopenTo === t ? `Reopen (to ${STAGE_LABELS[t]})` : `Move to ${STAGE_LABELS[t]}`

  return (
    <>
      {err && <span className="v2-stat" style={{ ['--chan' as string]: 'var(--v2-red-ink)' }}>{err}</span>}
      {next && <button onClick={() => move(next)} disabled={busy} className="v2-act" data-solid>Move to {STAGE_LABELS[next]}</button>}
      {reopenTo && <button onClick={() => move(reopenTo)} disabled={busy} className="v2-act">{stage === 'closed_no_sale' ? 'Reopen this estimate' : 'Reopen order'}</button>}
      {isLiveStage(stage) && (
        <button onClick={() => { setTarget(''); setNote(''); setErr(null); setOpen(true) }} disabled={busy} className="v2-act">Move to…</button>
      )}
      {canManualTransition(stage, 'closed_no_sale') && (
        <button onClick={() => move('closed_no_sale')} disabled={busy} className="v2-act">Close – no sale</button>
      )}

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        dismissable={!busy}
        title="Move this order"
        actions={
          <>
            <button onClick={() => target && move(target, note)} disabled={busy || !target} className="v2-act" data-solid data-danger={target === 'cancelled' || undefined}>
              {busy ? 'Moving…' : target ? label(target) : 'Choose a stage'}
            </button>
            <button onClick={() => setOpen(false)} disabled={busy} className="v2-act">Cancel</button>
          </>
        }
      >
        <p className="v2-hint" style={{ marginBottom: 14 }}>
          Currently <b>{STAGE_LABELS[stage]}</b>. Any stage is allowed, forwards or back — the move, who made it and the reason all go on the timeline.
        </p>
        <div className="v2-form" style={{ gridTemplateColumns: '1fr' }}>
          <div className="v2-fld"><label htmlFor="stage-target">Move to</label>
            <span className="v2-sel">
              <select id="stage-target" value={target} onChange={(e) => setTarget(e.target.value as OrderStage)}>
                <option value="">—</option>
                <optgroup label="Working stages">
                  {targets.filter(isLiveStage).map((t) => <option key={t} value={t}>{STAGE_LABELS[t]}</option>)}
                </optgroup>
                {targets.some((t) => !isLiveStage(t)) && (
                  <optgroup label="Endings">
                    {targets.filter((t) => !isLiveStage(t)).map((t) => <option key={t} value={t}>{label(t)}</option>)}
                  </optgroup>
                )}
              </select>
            </span>
          </div>
          <div className="v2-fld"><label htmlFor="stage-note">Reason (optional)</label>
            <input id="stage-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. customer changed the centre stone" maxLength={500} /></div>
        </div>
        {err && <div className="v2-notice" style={{ ['--ghue' as string]: 'var(--v2-t4)', marginTop: 14 }}><p>{err}</p></div>}
      </Modal>
      {dialog}
    </>
  )
}
