'use client'

import { useRouter } from 'next/navigation'
import { useConfirm } from '@/components/v2/confirm'
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
  const { ask, dialog } = useConfirm()
  const [err, setErr] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)

  const run = async (action: 'invoice' | 'archive') => {
    if (action === 'archive' && !(await ask({
      title: 'Copy these pieces into your catalog?',
      body: 'Quantities are set to zero — the piece has been delivered, so you own none of it. This adds the design to the catalogue so it can be made again; it does not change this order.',
      confirmLabel: 'Add to catalog',
    }))) return
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
    /* This was the one component in the tree using the `neutral-` greyscale while everything around
       it used `gray-` — a real inconsistency the survey turned up, and one that disappears by
       having no greyscale of its own at all. */
    <div className="v2-card">
      <div>
        <p style={{ fontSize: 14.5, fontWeight: 600, color: 'var(--v2-ink)' }}>This job is finished</p>
        <span>Raise the invoice from what is already here, or keep the piece in your catalog. Nothing needs re-typing.</span>
      </div>
      <div className="v2-bar">
        <button onClick={() => run('invoice')} disabled={busy !== null} className="v2-act" data-solid>
          <FileText className="h-3.5 w-3.5" /> {busy === 'invoice' ? 'Working…' : invoicedAt ? 'Open invoice' : 'Raise invoice'}
        </button>
        <button onClick={() => run('archive')} disabled={busy !== null || !!archivedAt} className="v2-act">
          <Archive className="h-3.5 w-3.5" /> {archivedAt ? 'In catalog' : busy === 'archive' ? 'Working…' : 'Add to catalog'}
        </button>
      </div>
      {invoicedAt && <p className="v2-kick">Invoiced {new Date(invoicedAt).toLocaleDateString()}</p>}
      {note && <div className="v2-notice" style={{ ['--ghue' as string]: 'var(--v2-t2)' }}><p>{note}</p></div>}
      {err && <div className="v2-notice" style={{ ['--ghue' as string]: 'var(--v2-t4)' }}><p>{err}</p></div>}
      {dialog}
    </div>
  )
}
