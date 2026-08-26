'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ORDER_STAGES, STAGE_LABELS, canManualTransition, type OrderStage } from '@/lib/orders/stages'
import { useConfirm } from '@/components/v2/confirm'

// Manual stage moves only (production→ready→delivered→completed, or cancel). Approval-stage transitions are
// intentionally NOT offered here — they happen through the workflow actions and are rejected server-side.
/** Back to 'new' out of a no-sale is the machine's one backwards move, and it is worded as one. */
const reopening = (from: OrderStage, to: OrderStage) => from === 'closed_no_sale' && to === 'new'

export function StageControl({ orderId, stage }: { orderId: string; stage: OrderStage }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null)
  const { ask, dialog } = useConfirm()
  const targets = ORDER_STAGES.filter((s) => canManualTransition(stage, s))

  const move = async (to: OrderStage) => {
    // CLOSING AS NO-SALE DOES NOT CONFIRM, and that is deliberate. The two below warn because
    // neither can be undone; this one is the ordinary end of an estimate, it can be undone from the
    // same button, and nothing is lost either way. Thirty of these a day behind a dialog would be
    // sixty taps a day to record the normal outcome of the business.
    //
    // Reopening does not confirm either: it is the undo.
    //
    // Both terminal moves confirm, because neither is reversible: nothing transitions OUT of a
    // terminal stage. The sentences differ because the acts do — one says the job is over, the other
    // says it is not happening.
    if (to === 'cancelled' && !(await ask({
      title: 'Cancel this order?',
      // Says what cancel actually does, which is not what it sounded like. Nothing was ever deleted;
      // what is true is that it is final. An estimate the customer simply did not take has its own
      // button now, and that one comes back.
      body: 'Nothing is deleted — the order, its line items and its history all stay. What cannot be undone is the stage: nothing transitions out of a cancelled order. If the customer simply did not buy, close it as no sale instead, which can be reopened.',
      confirmLabel: 'Cancel the order', danger: true,
    }))) return
    if (to === 'finished' && !(await ask({
      title: 'Mark this order finished?',
      body: 'It cannot be reopened. Invoicing is separate — a finished order can still be invoiced afterwards.',
      confirmLabel: 'Mark finished', danger: true,
    }))) return
    setBusy(true); setErr(null)
    try {
      const r = await fetch(`/api/orders/${orderId}/stage`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ toStage: to }) })
      // The message is the store's: it knows the constraint code and which migration teaches the
      // database this particular stage. Translating it again here would be the same rule in two
      // places, and the copy further from the failure would be the one that went stale.
      if (!r.ok) throw new Error((await r.json()).error || 'Failed'); router.refresh()
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }
  if (targets.length === 0) return null
  return (
    /* `display: contents` so these pills join the page's own action bar rather than forming a
        second nested one — the bar's separator has to be able to sit between them. */
    <>
      {err && <span className="v2-stat" style={{ ['--chan' as string]: 'var(--v2-red-ink)' }}>{err}</span>}
      {targets.map((t) => (
        /* Reopening is the one move that is neither a step forward nor an ending, so it is the one
           pill that is neither filled nor red — it is the undo, and it should read as one. */
        <button key={t} onClick={() => move(t)} disabled={busy} className="v2-act"
                data-danger={t === 'cancelled' || undefined}
                data-solid={t !== 'cancelled' && t !== 'finished' && t !== 'closed_no_sale' && !reopening(stage, t) || undefined}>
          {t === 'cancelled' ? 'Cancel order'
            : t === 'finished' ? 'Mark finished'
            : t === 'closed_no_sale' ? 'Close – no sale'
            : reopening(stage, t) ? 'Reopen this estimate'
            : `Move to ${STAGE_LABELS[t]}`}
        </button>
      ))}
      {dialog}
    </>
  )
}
