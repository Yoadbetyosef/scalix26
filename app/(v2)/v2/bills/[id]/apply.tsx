'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Sheet } from '../../form-sheet'
import { Check } from '../glyphs'

// APPLYING A BILL — the one press on this screen that changes a number anywhere else.
//
// It writes a cost onto every matched product, and a cost becomes a price. So it confirms, and the
// confirmation names what is about to happen rather than asking "are you sure".
//
// ── THE DIVERGENCE 409 IS NOT AN ERROR ──────────────────────────────────────────────────────────
//
// The route answers 409 with the flagged products when one or more costs would move enough to move
// their margins. That is the write ASKING TO BE CONFIRMED, and `acknowledgeDivergence` is what gets
// recorded on the shipment — so it is never sent on the first attempt and never defaulted on. A
// default would turn the audit trail into a lie about what anybody saw.
//
// The screen behind this sheet already shows every one of those products under COST WILL MOVE. The
// sheet repeats them anyway, because a person who scrolled past them and pressed Apply has not read
// them, and this is the last moment where that can still be true.

interface Flagged { productName: string | null; previousCost: number; nextCost: number; deltaRelative: number }

export function ApplyBill({
  shipmentId, canApply, matchedLines, alreadyApplied,
}: { shipmentId: string; canApply: boolean; matchedLines: number; alreadyApplied: boolean }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [flagged, setFlagged] = useState<Flagged[] | null>(null)

  if (alreadyApplied) {
    // Re-applying OVERWRITES what the first apply wrote, and it needs its own screen and its own
    // sentence about the date of the earlier one. Not this button wearing a different word.
    return <button type="button" className="v2-bl-apply" disabled>Applied</button>
  }

  async function apply(acknowledge: boolean) {
    if (busy) return
    setBusy(true); setErr(null)
    try {
      const res = await fetch(`/api/invoices/shipments/${shipmentId}/apply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(acknowledge ? { acknowledgeDivergence: true } : {}),
      })
      const j = await res.json().catch(() => ({}))
      if (res.status === 409 && j.needsAcknowledgement) {
        setFlagged((j.divergences ?? []) as Flagged[])
        setConfirming(false)
        return
      }
      // The route's own sentence — the RPC's guards come back as words a person can read.
      if (!res.ok || j.ok === false) { setErr(j.error || 'Those costs could not be applied.'); return }
      setConfirming(false); setFlagged(null)
      router.refresh()
    } catch {
      setErr('Those costs could not be applied — check your connection.')
    } finally {
      setBusy(false)
    }
  }

  const money = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 2 })

  return (
    <>
      <button
        type="button"
        className="v2-bl-apply"
        disabled={!canApply || busy}
        onClick={() => setConfirming(true)}
      >
        <Check />{busy ? 'Applying…' : `Apply to ${matchedLines} ${matchedLines === 1 ? 'line' : 'lines'}`}
      </button>

      {(confirming || flagged) && (
        <Sheet
          title={flagged ? 'These costs move a margin' : 'Apply these costs'}
          busy={busy}
          onClose={() => { setConfirming(false); setFlagged(null); setErr(null) }}
        >
          {flagged ? (
            <>
              <p className="v2-iv-ss">
                {flagged.length === 1 ? 'One product' : `${flagged.length} products`} would change enough to matter.
                Applying is not reversible.
              </p>
              {flagged.map((f, i) => (
                <p className="v2-bl-lcost" key={`${f.productName}-${i}`}>
                  <span className="v2-bl-now">{f.productName || 'Unnamed product'}</span>
                  <span className="v2-bl-was">{money(f.previousCost)}</span>
                  <span className="v2-bl-now">{money(f.nextCost)}</span>
                  <span className="v2-bl-delta" data-ok={f.deltaRelative < 0 || undefined}>
                    {f.deltaRelative < 0 ? '−' : '+'}{Math.abs(Math.round(f.deltaRelative * 100))}%
                  </span>
                </p>
              ))}
              {err && <p className="v2-emsg" data-bad>{err}</p>}
              <div className="v2-eacts">
                <button type="button" className="v2-esec" onClick={() => { setFlagged(null); setErr(null) }} disabled={busy}>
                  Not yet
                </button>
                <button type="button" className="v2-epri" onClick={() => void apply(true)} disabled={busy}>
                  {busy ? 'Applying…' : 'I have read these — apply'}
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="v2-iv-ss">
                This writes a landed cost onto every matched product, replacing what is there now.
                It is not reversible.
              </p>
              {err && <p className="v2-emsg" data-bad>{err}</p>}
              <div className="v2-eacts">
                <button type="button" className="v2-esec" onClick={() => setConfirming(false)} disabled={busy}>Cancel</button>
                <button type="button" className="v2-epri" onClick={() => void apply(false)} disabled={busy}>
                  {busy ? 'Applying…' : `Apply to ${matchedLines} ${matchedLines === 1 ? 'line' : 'lines'}`}
                </button>
              </div>
            </>
          )}
        </Sheet>
      )}
    </>
  )
}
