'use client'

import { useState } from 'react'

// Customer actions on the public proposal page: Accept, Decline, Download PDF (browser print-to-PDF — no
// heavy server dependency). Posts to the public token API; the token is the sole credential.
export function ProposalPublicActions({ token, done, expired, status }: { token: string; done: boolean; expired: boolean; status: string }) {
  const [state, setState] = useState<'idle' | 'accept' | 'decline'>('idle')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<string | null>(done ? status : null)
  const [error, setError] = useState<string | null>(null)

  async function respond(action: 'accept' | 'decline') {
    setBusy(true); setError(null)
    const res = await fetch(`/api/proposals/${token}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action, name: name.trim() || null, email: email.trim() || null, reason: reason.trim() || null }) })
    const d = await res.json().catch(() => ({}))
    setBusy(false)
    if (res.ok && d.ok) setResult(d.status)
    else setError(d.error === 'expired' ? 'This proposal has expired.' : d.error === 'already_responded' ? 'A response was already recorded.' : 'Something went wrong. Please try again.')
  }

  if (result) return (
    <div className="mt-4 rounded-2xl border border-[#e5e7eb] bg-white px-6 py-5 text-center shadow-sm print:hidden">
      <p className="text-sm font-medium text-[#111827]">{result === 'accepted' ? 'Thank you — your acceptance has been recorded.' : result === 'converted' ? 'This proposal has been finalized.' : 'Your response has been recorded.'}</p>
      <button onClick={() => window.print()} className="mt-3 text-sm font-medium text-[#2563eb] hover:underline">Download PDF</button>
    </div>
  )

  return (
    <div className="mt-4 rounded-2xl border border-[#e5e7eb] bg-white px-6 py-5 shadow-sm print:hidden">
      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}
      {state === 'idle' && (
        <div className="flex flex-wrap items-center gap-3">
          <button disabled={expired} onClick={() => setState('accept')} className="rounded-lg bg-[#111827] px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-40">Accept proposal</button>
          <button disabled={expired} onClick={() => setState('decline')} className="rounded-lg border border-[#d1d5db] px-5 py-2.5 text-sm font-medium text-[#374151] disabled:opacity-40">Decline</button>
          <button onClick={() => window.print()} className="ml-auto text-sm font-medium text-[#2563eb] hover:underline">Download PDF</button>
        </div>
      )}
      {state !== 'idle' && (
        <div className="space-y-3">
          <p className="text-sm font-medium text-[#111827]">{state === 'accept' ? 'Accept this proposal' : 'Decline this proposal'}</p>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" className="w-full rounded-lg border border-[#d1d5db] px-3 py-2 text-sm" />
          <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Your email (optional)" className="w-full rounded-lg border border-[#d1d5db] px-3 py-2 text-sm" />
          {state === 'decline' && <textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (optional)" rows={2} className="w-full rounded-lg border border-[#d1d5db] px-3 py-2 text-sm" />}
          <div className="flex gap-2">
            <button disabled={busy} onClick={() => respond(state)} className="rounded-lg bg-[#111827] px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{busy ? 'Submitting…' : state === 'accept' ? 'Confirm acceptance' : 'Confirm decline'}</button>
            <button disabled={busy} onClick={() => setState('idle')} className="rounded-lg border border-[#d1d5db] px-5 py-2.5 text-sm text-[#374151]">Back</button>
          </div>
        </div>
      )}
    </div>
  )
}
