'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ORDER_STAGES, STAGE_LABELS, canManualTransition, type OrderStage } from '@/lib/orders/stages'
import { useConfirm } from '@/components/v2/confirm'

// Manual stage moves only (production→ready→delivered→completed, or cancel). Approval-stage transitions are
// intentionally NOT offered here — they happen through the workflow actions and are rejected server-side.
export function StageControl({ orderId, stage }: { orderId: string; stage: OrderStage }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null)
  const { ask, dialog } = useConfirm()
  const targets = ORDER_STAGES.filter((s) => canManualTransition(stage, s))

  const move = async (to: OrderStage) => {
    // Both terminal moves confirm, because neither is reversible: nothing transitions OUT of a
    // terminal stage. The sentences differ because the acts do — one says the job is over, the other
    // says it is not happening.
    if (to === 'cancelled' && !(await ask({
      title: 'Cancel this order?',
      body: 'The order stays on the list and keeps its history — it stops being work in progress. Nothing transitions out of a cancelled order, so this cannot be undone from here.',
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
        <button key={t} onClick={() => move(t)} disabled={busy} className="v2-act"
                data-danger={t === 'cancelled' || undefined}
                data-solid={t !== 'cancelled' && t !== 'finished' || undefined}>
          {t === 'cancelled' ? 'Cancel order' : t === 'finished' ? 'Mark finished' : `Move to ${STAGE_LABELS[t]}`}
        </button>
      ))}
      {dialog}
    </>
  )
}
