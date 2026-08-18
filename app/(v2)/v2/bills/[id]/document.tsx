'use client'

import { useState } from 'react'
import { Doc } from '../glyphs'

// THE DOCUMENT ITSELF.
//
// This screen asks an owner to check every figure on it against a piece of paper, and until now it
// would not show them the paper. That is the whole justification: the four tiles across the top say
// "what the invoice states", the note under the rate says "the rate you actually paid", and neither
// sentence means anything to somebody who cannot see the invoice.
//
// ── THE URL IS MINTED ON THE PRESS, NOT ON RENDER ──────────────────────────────────────────────
//
// The bucket is private and the signed link lasts five minutes. Minting it while the page renders
// would hand out a link that is dead by the time a person scrolling a 133-line bill reaches for it —
// and would mint one for every load whether or not anybody wanted the document. So the press does it,
// which costs a round trip in the one case somebody actually asked.
//
// window.open rather than an <a href>: there is no URL to put in the markup until the request comes
// back. The tab is opened from inside the click handler for the same reason a file picker is —
// a browser only trusts a window opened by a gesture — and the await between the two is why some
// blockers still refuse it, which is what the fallback link is for.

export function ViewDocument({ shipmentId, fileName }: { shipmentId: string; fileName: string }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  // A link the person can press themselves when the popup was blocked. Held rather than re-fetched:
  // the same signature is still good, and asking for a second one would say the first was wrong.
  const [blocked, setBlocked] = useState<string | null>(null)

  async function open() {
    if (busy) return
    setBusy(true); setErr(null); setBlocked(null)
    try {
      const res = await fetch(`/api/invoices/shipments/${shipmentId}/file`)
      const j = await res.json().catch(() => ({}))
      if (!res.ok || !j.url) { setErr(j.error || 'That document could not be opened.'); return }
      const tab = window.open(j.url as string, '_blank', 'noopener,noreferrer')
      if (!tab) setBlocked(j.url as string)
    } catch {
      setErr('That document could not be opened — check your connection.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <button type="button" className="v2-bl-doc-btn" onClick={() => void open()} disabled={busy}>
        <Doc />{busy ? 'Opening…' : 'View the document'}
      </button>
      <span className="v2-bl-doc-name">{fileName}</span>
      {err && <p className="v2-emsg" data-bad>{err}</p>}
      {blocked && (
        <p className="v2-emsg">
          Your browser blocked the new tab.{' '}
          <a href={blocked} target="_blank" rel="noreferrer">Open it here instead</a> — the link is good
          for a few minutes.
        </p>
      )}
    </>
  )
}
