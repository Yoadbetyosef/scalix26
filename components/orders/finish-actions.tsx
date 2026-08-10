'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { FileText, Archive } from 'lucide-react'

// What happens to a completed job.
//
// Two actions, independent by design: a job can be invoiced and not archived, archived and not
// invoiced, or both. Neither re-enters anything — the invoice is the order rendered as an invoice, and
// the archive copies the line items straight into the catalog.

export function FinishActions({ orderId, invoicedAt, archivedAt }: {
  orderId: string; invoicedAt?: string | null; archivedAt?: string | null
}) {
  const router = useRouter()
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)

  const run = async (action: 'invoice' | 'archive') => {
    if (action === 'archive' && !confirm('Copy these pieces into your catalog? Quantities are set to zero — the piece has been delivered, so you own none of it.')) return
    setBusy(action); setErr(null); setNote(null)
    try {
      const r = await fetch(`/api/orders/${orderId}/finish`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) { setErr(j.error || 'Failed'); return }
      if (action === 'invoice') router.push(`/orders/${orderId}/document/invoice`)
      else { setNote(`Added ${j.created ?? 0} item(s) to your catalog.`); router.refresh() }
    } catch (e) {
      setErr((e as Error).message)
    } finally { setBusy(null) }
  }

  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-4">
      <p className="text-sm font-semibold text-neutral-900">This job is finished</p>
      <p className="mt-0.5 text-xs text-neutral-500">Raise the invoice from what is already here, or keep the piece in your catalog. Nothing needs re-typing.</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button onClick={() => run('invoice')} disabled={busy !== null}
          className="inline-flex items-center gap-1.5 rounded-lg bg-neutral-900 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50">
          <FileText className="h-4 w-4" /> {busy === 'invoice' ? 'Working…' : invoicedAt ? 'Open invoice' : 'Raise invoice'}
        </button>
        <button onClick={() => run('archive')} disabled={busy !== null || !!archivedAt}
          className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-300 px-3 py-1.5 text-sm font-semibold text-neutral-700 disabled:opacity-50">
          <Archive className="h-4 w-4" /> {archivedAt ? 'In catalog' : busy === 'archive' ? 'Working…' : 'Add to catalog'}
        </button>
      </div>
      {invoicedAt && <p className="mt-2 text-xs text-neutral-400">Invoiced {new Date(invoicedAt).toLocaleDateString()}</p>}
      {note && <p className="mt-2 text-xs text-emerald-700">{note}</p>}
      {err && <p className="mt-2 text-xs text-red-600">{err}</p>}
    </div>
  )
}
