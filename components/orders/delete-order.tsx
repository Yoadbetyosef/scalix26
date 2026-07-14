'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

// Permanently delete an order (and its line items, timeline, attachments, and approval links). Irreversible —
// distinct from "Cancel order", which only moves the stage. Double confirmation before the destructive call.
export function DeleteOrderButton({ orderId, orderNumber }: { orderId: string; orderNumber: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null)

  const del = async () => {
    if (!confirm(`Permanently delete order ${orderNumber}? This removes the order, its files, and all approval links. This cannot be undone.`)) return
    setBusy(true); setErr(null)
    try {
      const r = await fetch(`/api/orders/${orderId}`, { method: 'DELETE' })
      if (!r.ok) throw new Error((await r.json()).error || 'Failed to delete')
      router.push('/orders'); router.refresh()
    } catch (e) { setErr((e as Error).message); setBusy(false) }
  }

  return (
    <span className="flex items-center gap-2">
      {err && <span className="text-xs text-red-600">{err}</span>}
      <button onClick={del} disabled={busy} className="rounded-lg border border-red-200 px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-40">{busy ? 'Deleting…' : 'Delete order'}</button>
    </span>
  )
}
