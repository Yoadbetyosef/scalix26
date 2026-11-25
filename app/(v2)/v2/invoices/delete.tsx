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

  async function press(e: React.MouseEvent<HTMLButtonElement>) {
    if (busy) return
    if (!armed) { setArmed(true); setError(null); return }
    const row = e.currentTarget.closest<HTMLElement>('.v2-iv-line')?.parentElement ?? null
    setBusy(true)
    try {
      const res = await fetch(endpoint ?? `/api/core/documents/invoice/${id}`, { method: 'DELETE' })
      const body = await res.json().catch(() => ({})) as { ok?: boolean; error?: string }
      // 404 is "it is already gone" — a second press that raced the first, or another tab. That is the
      // outcome that was asked for, not a failure to show somebody.
      if (!(res.ok && body.ok) && res.status !== 404) { setError(body.error || 'Could not delete it.'); setArmed(false); setBusy(false); return }
      // GONE NOW, not when the list comes back. The row stayed on screen — and stayed a link — for the
      // second or so the refresh takes, and a tap on it in that window opened an invoice that no
      // longer existed. Hide it immediately; the refresh then removes it for real. The button stays
      // busy on purpose, so it cannot be pressed again in the meantime.
      if (row) row.style.display = 'none'
      router.refresh()
    } catch {
      setError('Could not delete it.'); setArmed(false); setBusy(false)
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
