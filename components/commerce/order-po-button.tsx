'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export function OrderPoButton({ orderId, suppliers }: { orderId: string; suppliers: { id: string; company_name: string }[] }) {
  const router = useRouter()
  const [supplierId, setSupplierId] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const create = async () => {
    setBusy(true); setErr(null)
    try {
      const r = await fetch(`/api/commerce/orders/${orderId}/purchase-order`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ supplierId: supplierId || null }) })
      const j = await r.json()
      if (r.ok && j.po?.id) router.push(`/commerce/purchase-orders/${j.po.id}`)
      else { setErr(j.error === 'nothing_missing' ? 'Nothing missing to purchase.' : (j.error || 'Failed')); setBusy(false) }
    } catch (e) { setErr((e as Error).message); setBusy(false) }
  }
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)} className="rounded-lg border border-amber-300 bg-white px-2 py-1.5 text-sm">
        <option value="">Choose supplier (optional)…</option>
        {suppliers.map((s) => <option key={s.id} value={s.id}>{s.company_name}</option>)}
      </select>
      <button onClick={create} disabled={busy} className="rounded-lg bg-amber-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-40">{busy ? 'Creating…' : 'Create PO for missing items'}</button>
      {err && <span className="text-xs text-red-600">{err}</span>}
    </div>
  )
}
