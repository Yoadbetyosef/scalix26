'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useConfirm } from '@/components/v2/confirm'

// Permanently delete an order (and its line items, timeline, attachments, and approval links). Irreversible —
// distinct from "Cancel order", which only moves the stage. Double confirmation before the destructive call.
export function DeleteOrderButton({ orderId, orderNumber }: { orderId: string; orderNumber: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null)
  const { ask, dialog } = useConfirm()

  const del = async () => {
    if (!(await ask({
      title: `Delete ${orderNumber}?`,
      body: 'This removes the order, its line items, its timeline, every file attached to it, and all approval links — including any the factory or the customer still has open. It cannot be undone.',
      confirmLabel: 'Delete permanently', danger: true,
    }))) return
    setBusy(true); setErr(null)
    try {
      const r = await fetch(`/api/orders/${orderId}`, { method: 'DELETE' })
      if (!r.ok) throw new Error((await r.json()).error || 'Failed to delete')
      router.push('/orders'); router.refresh()
    } catch (e) { setErr((e as Error).message); setBusy(false) }
  }

  return (
    <>
      {err && <span className="v2-stat" style={{ ['--chan' as string]: 'var(--v2-red-ink)' }}>{err}</span>}
      <button onClick={del} disabled={busy} className="v2-act" data-danger>{busy ? 'Deleting…' : 'Delete order'}</button>
      {dialog}
    </>
  )
}
