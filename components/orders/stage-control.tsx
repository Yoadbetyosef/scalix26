'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ORDER_STAGES, STAGE_LABELS, canManualTransition, type OrderStage } from '@/lib/orders/stages'

// Manual stage moves only (production→ready→delivered→completed, or cancel). Approval-stage transitions are
// intentionally NOT offered here — they happen through the workflow actions and are rejected server-side.
export function StageControl({ orderId, stage }: { orderId: string; stage: OrderStage }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null)
  const targets = ORDER_STAGES.filter((s) => canManualTransition(stage, s))

  const move = async (to: OrderStage) => {
    if (to === 'cancelled' && !confirm('Cancel this order?')) return
    setBusy(true); setErr(null)
    try {
      const r = await fetch(`/api/orders/${orderId}/stage`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ toStage: to }) })
      if (!r.ok) throw new Error((await r.json()).error || 'Failed'); router.refresh()
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }
  if (targets.length === 0) return null
  return (
    <div className="flex flex-wrap items-center gap-2">
      {err && <span className="text-xs text-red-600">{err}</span>}
      {targets.map((t) => (
        <button key={t} onClick={() => move(t)} disabled={busy} className={`rounded-lg px-3 py-1.5 text-sm font-medium disabled:opacity-40 ${t === 'cancelled' ? 'border border-red-200 text-red-600 hover:bg-red-50' : 'bg-gray-900 text-white hover:bg-gray-800'}`}>{t === 'cancelled' ? 'Cancel order' : `Move to ${STAGE_LABELS[t]}`}</button>
      ))}
    </div>
  )
}
