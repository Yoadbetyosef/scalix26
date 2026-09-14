'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { FileText } from 'lucide-react'

// Raise (or open) the invoice from the action bar — at any stage but cancelled.
//
// The invoice is the order rendered as an invoice; "raising" it stamps invoiced_at the first time
// and opens the document. It does not wait for production: TG invoices at the deposit and collects
// the balance at pickup, and the payments panel — not the stage — says how much has arrived.
export function InvoiceButton({ orderId, invoicedAt }: { orderId: string; invoicedAt?: string | null }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const go = async () => {
    if (invoicedAt) { window.open(`/orders/${orderId}/document/invoice`, '_blank', 'noopener'); return }
    setBusy(true); setErr(null)
    try {
      const r = await fetch(`/api/orders/${orderId}/finish`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'invoice' }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.error || 'Could not raise the invoice.')
      window.open(`/orders/${orderId}/document/invoice`, '_blank', 'noopener')
      router.refresh()
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }

  return (
    <>
      {err && <span className="v2-stat" style={{ ['--chan' as string]: 'var(--v2-red-ink)' }}>{err}</span>}
      <button onClick={go} disabled={busy} className="v2-act" title={invoicedAt ? `Invoiced ${new Date(invoicedAt).toLocaleDateString()}` : 'Raise the invoice from what is already here'}>
        <FileText className="h-3.5 w-3.5" /> {busy ? 'Working…' : invoicedAt ? 'Invoice ↗' : 'Raise invoice'}
      </button>
    </>
  )
}
