'use client'

import { useState } from 'react'

// The one thing the customer does on a quote. Says what happened in words, in place, and prints.
export function AcceptQuote({ token, state, business }: { token: string; state: 'waiting' | 'accepted' | 'expired' | 'draft'; business: string }) {
  const [done, setDone] = useState(state === 'accepted')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(state === 'expired' ? 'This quote has expired. Please ask for an updated one.' : null)

  async function accept() {
    if (busy || done) return
    setBusy(true); setError(null)
    try {
      const res = await fetch(`/api/quote/${token}/accept`, { method: 'POST' })
      const j = await res.json().catch(() => ({})) as { ok?: boolean; error?: string }
      if (!res.ok || !j.ok) setError(j.error || 'That did not go through. Please try again.')
      else setDone(true)
    } catch { setError('That did not go through. Please check your connection and try again.') } finally { setBusy(false) }
  }

  return (
    <div className="mt-8 print:hidden">
      {done ? (
        <p className="border border-[#2b2b2b] px-5 py-4 text-sm">Thank you — you have accepted this quote. {business} will be in touch to confirm your order.</p>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          {state !== 'expired' && state !== 'draft' && (
            <button type="button" onClick={accept} disabled={busy} className="rounded-[2px] bg-[#111] px-7 py-3.5 text-sm font-medium tracking-[0.08em] text-white disabled:opacity-60">
              {busy ? 'SENDING…' : 'ACCEPT THIS QUOTE'}
            </button>
          )}
          <button type="button" onClick={() => window.print()} className="rounded-[2px] border border-neutral-300 px-5 py-3.5 text-sm">Download PDF</button>
        </div>
      )}
      {state === 'draft' && !done && <p className="mt-3 text-[13px] text-neutral-500">Preview — the customer gets an Accept button here once the quote is sent.</p>}
      {error && <p className="mt-3 text-sm text-[#A8102C]">{error}</p>}
    </div>
  )
}
