'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Check } from '../glyphs'

// ISSUING, from the invoice itself.
//
// One press, no sheet: there is nothing to fill in. Issuing stamps the date and closes the lines, and
// both of those are consequences of the press rather than choices to make — a form would be asking a
// question that has no second answer.
//
// It is not undoable, and the button says so before it is pressed rather than after.

export function IssueInvoice({ invoiceId, number, canIssue }: { invoiceId: string; number: string; canIssue: boolean }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  if (!canIssue) {
    return <button type="button" className="v2-iv-btn" disabled title="An invoice with no lines cannot be issued">Issue</button>
  }

  async function issue() {
    if (busy) return
    setBusy(true); setErr(null)
    try {
      const res = await fetch(`/api/core/documents/invoice/${invoiceId}/issue`, { method: 'POST' })
      const j = await res.json().catch(() => ({}))
      // The route's own sentence, verbatim — it is already written for a person to read.
      if (!res.ok) { setErr(j.error || 'That did not issue.'); setConfirming(false); return }
      router.refresh()
    } catch {
      setErr('That did not issue — check your connection.')
    } finally {
      setBusy(false)
    }
  }

  if (err) return <span className="v2-iv-btn" data-static>{err}</span>

  // The confirmation and the sentence it is about live in ONE place, so a change to either cannot
  // leave the other describing something else.
  if (confirming) {
    return (
      <>
        <button type="button" className="v2-iv-btn" onClick={() => setConfirming(false)} disabled={busy}>Cancel</button>
        <button type="button" className="v2-iv-btn" data-p data-touch onClick={() => void issue()} disabled={busy}>
          {busy ? 'Issuing…' : `Issue ${number} — final`}
        </button>
      </>
    )
  }

  return (
    <button type="button" className="v2-iv-btn" data-p data-touch onClick={() => setConfirming(true)}>
      <Check />Issue
    </button>
  )
}
