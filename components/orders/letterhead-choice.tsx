'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { FileText } from 'lucide-react'
import type { LetterheadStyle } from '@/lib/documents/letterhead-styles'

// WHICH LETTERHEAD THIS ONE DOCUMENT GOES OUT ON.
//
// Her default lives in Branding; this is the override, and it sits on the document beside Send because
// that is the moment she knows which company the customer is buying from. A trade customer gets the
// T.G. Designs paper, a retail customer the other, and neither choice should mean editing a setting
// that governs everything else she sends that week.
//
// It writes to the ORDER, not to a preview. The estimate, the invoice and the link the customer opens
// all read the same column, so what she sees here is what the customer receives — the same reason the
// two document routes share one body.
export function LetterheadChoice({ orderId, value, options }: {
  orderId: string
  /** Null = follow her default, which is what the first option says. */
  value: string | null
  options: Array<{ style: LetterheadStyle; label: string; isDefault: boolean }>
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function choose(next: string) {
    setBusy(true); setErr(null)
    try {
      const r = await fetch(`/api/orders/${orderId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        // Empty string means "back to my default", and null is how the column says that.
        body: JSON.stringify({ letterheadStyle: next || null }),
      })
      const j = await r.json().catch(() => ({} as { error?: string }))
      if (!r.ok) {
        // The column arrives by hand-run migration. Until it has, Postgres says "column
        // orders.letterhead_style does not exist", which is true and useless to whoever is reading it.
        const missing = /letterhead_style/.test(j.error ?? '') && /does not exist/i.test(j.error ?? '')
        throw new Error(missing ? 'Run add_letterhead_designs.sql first.' : (j.error || 'Could not change the letterhead.'))
      }
      router.refresh()
    } catch (e) {
      setErr((e as Error).message)
    } finally { setBusy(false) }
  }

  return (
    <span className="inline-flex items-center gap-1.5 print:hidden">
      <FileText className="h-4 w-4 text-neutral-400" aria-hidden />
      <select
        aria-label="Letterhead"
        value={value ?? ''}
        disabled={busy}
        onChange={(e) => choose(e.target.value)}
        className="rounded-lg border border-neutral-300 px-2 py-2 text-sm font-medium text-neutral-700 disabled:opacity-50"
      >
        {/* The default is named, not left as "Default": she should not have to remember which one that
            is to know what this document will print on. */}
        <option value="">{options.find((o) => o.isDefault)?.label ?? 'My default'} (default)</option>
        {options.map((o) => <option key={o.style} value={o.style}>{o.label}</option>)}
      </select>
      {err && <span className="text-xs text-red-600">{err}</span>}
    </span>
  )
}
