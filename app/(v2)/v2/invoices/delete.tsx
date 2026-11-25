'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Trash } from './glyphs'

// DELETE AN INVOICE NOBODY PAID.
//
// Sits beside a row, never inside the row's link — a bin inside an <a> opens the invoice on the way
// to deleting it. Two presses: the first arms it and says what the second will do, so an invoice is
// never lost to a thumb that was aiming at the row. Leaving the button disarms it.
//
// The server decides whether it may go (lib/core/documents.ts → deleteUnpaidInvoice). This only asks.
export function DeleteInvoice({ id, label, endpoint, noun = 'invoice' }: { id: string; label: string; /** Defaults to the invoice route; Quotes passes its own. */ endpoint?: string; noun?: string }) {
  const router = useRouter()
  const [armed, setArmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function press() {
    if (busy) return
    if (!armed) { setArmed(true); setError(null); return }
    setBusy(true)
    try {
      const res = await fetch(endpoint ?? `/api/core/documents/invoice/${id}`, { method: 'DELETE' })
      const body = await res.json().catch(() => ({})) as { ok?: boolean; error?: string }
      if (!res.ok || !body.ok) { setError(body.error || 'Could not delete it.'); setArmed(false); return }
      router.refresh()
    } catch {
      setError('Could not delete it.'); setArmed(false)
    } finally {
      setBusy(false)
    }
  }

  return (
    <button
      type="button"
      className="v2-iv-del"
      data-armed={armed || undefined}
      data-error={error ? true : undefined}
      disabled={busy}
      onClick={press}
      onBlur={() => setArmed(false)}
      aria-label={armed ? `Confirm deleting ${label}` : `Delete ${label}`}
      title={error ?? (armed ? 'Press again to delete' : `Delete ${noun}`)}
    >
      {armed ? <span>{busy ? 'Deleting…' : 'Delete?'}</span> : error ? <span>{error}</span> : <Trash />}
    </button>
  )
}
