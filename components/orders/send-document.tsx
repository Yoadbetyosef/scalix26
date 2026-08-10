'use client'

import { useState } from 'react'
import { Send } from 'lucide-react'

// Email this document to the customer.
//
// The link it creates is public and permanent unless revoked — the customer has no account and may
// open the estimate weeks later. An expiring link would fail on their side, silently, and they would
// simply think the business had sent them something broken.

export function SendDocument({ orderId, docType, defaultEmail, defaultName }: {
  orderId: string; docType: string; defaultEmail?: string | null; defaultName?: string | null
}) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [f, setF] = useState({ email: defaultEmail ?? '', name: defaultName ?? '', message: '' })

  const send = async () => {
    setBusy(true); setErr(null)
    try {
      const r = await fetch(`/api/orders/${orderId}/share`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ docType, recipientEmail: f.email, recipientName: f.name || null, message: f.message || null }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) {
        // The link may exist even when the email failed. Showing it lets the owner copy it by hand
        // rather than losing the work to a mail-server hiccup.
        setErr(j.error || 'Could not send.')
        if (j.url) setDone(j.url)
        return
      }
      setDone(j.url ?? null)
    } catch (e) {
      setErr((e as Error).message)
    } finally { setBusy(false) }
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-300 px-4 py-2 text-sm font-semibold text-neutral-700 hover:bg-neutral-50 print:hidden">
        <Send className="h-4 w-4" /> Send to customer
      </button>
    )
  }

  return (
    <div className="w-full max-w-sm rounded-xl border border-neutral-200 bg-white p-3 text-left shadow-sm print:hidden">
      {done ? (
        <>
          <p className="text-sm font-medium text-neutral-900">{err ? 'Link created — email failed' : 'Sent'}</p>
          {err && <p className="mt-1 text-xs text-red-600">{err}</p>}
          <p className="mt-2 break-all rounded bg-neutral-50 p-2 font-mono text-[11px] text-neutral-600">{done}</p>
          <button onClick={() => { setOpen(false); setDone(null); setErr(null) }} className="mt-2 text-xs font-medium text-neutral-500 underline">Close</button>
        </>
      ) : (
        <>
          <label className="block text-xs text-neutral-500">Customer email
            <input value={f.email} onChange={(e) => setF((p) => ({ ...p, email: e.target.value }))} placeholder="name@example.com"
              className="mt-1 w-full rounded-lg border border-neutral-300 px-2 py-1.5 text-sm" />
          </label>
          <label className="mt-2 block text-xs text-neutral-500">Name (optional)
            <input value={f.name} onChange={(e) => setF((p) => ({ ...p, name: e.target.value }))}
              className="mt-1 w-full rounded-lg border border-neutral-300 px-2 py-1.5 text-sm" />
          </label>
          <label className="mt-2 block text-xs text-neutral-500">Message (optional)
            <textarea value={f.message} onChange={(e) => setF((p) => ({ ...p, message: e.target.value }))} rows={2}
              className="mt-1 w-full rounded-lg border border-neutral-300 px-2 py-1.5 text-sm" />
          </label>
          {err && <p className="mt-2 text-xs text-red-600">{err}</p>}
          <div className="mt-3 flex gap-2">
            <button onClick={send} disabled={busy || !f.email} className="rounded-lg bg-neutral-900 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50">
              {busy ? 'Sending…' : 'Send'}
            </button>
            <button onClick={() => setOpen(false)} className="text-sm text-neutral-500 underline">Cancel</button>
          </div>
        </>
      )}
    </div>
  )
}
