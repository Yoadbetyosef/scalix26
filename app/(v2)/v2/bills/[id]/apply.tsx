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
// ── THREE FLAGS, NONE OF THEM EVER DEFAULTED ────────────────────────────────────────────────────
//
//   override              — apply below the coverage gate. The owner has read the figure and judged.
//   reapply               — this bill has been applied once already, and this OVERWRITES it.
//   acknowledgeDivergence — costs are about to move enough to move margins, and they were shown.
//
// Each one is an act, so each is asked for by name and travels only from the sheet that said what it
// means. See the route for what the database does with them.
//
// ── THE DIVERGENCE 409 IS NOT AN ERROR ──────────────────────────────────────────────────────────
//
// The route answers 409 with the flagged products when one or more costs would move enough to move
// their margins. That is the write ASKING TO BE CONFIRMED, and `acknowledgeDivergence` is what gets
// recorded on the shipment — so it is never sent on the first attempt and never defaulted on. A
// default would turn the audit trail into a lie about what anybody saw.
//
// It also means the flags of the FIRST attempt have to survive the round trip: an override that
// dropped on the way to the acknowledgement would come back as a coverage refusal the owner already
// answered. `pending` holds them.
//
// ── WHY THE ACKNOWLEDGEMENT IS ONLY EVER OFFERED FROM THE SERVER'S OWN LIST ─────────────────────
//
// v1 learned this on 7 Aug 2026: its Overwrite button sent acknowledgeDivergence unconditionally on
// the reasoning that "the banner is visible above", and a stale tab then moved 166 products' costs
// carrying a record that claimed their sentences had been read while the banner was never on screen.
// v1's fix was to render the sentences and the button in one block. This does the same thing one step
// further back — the list rendered beside the button is the one the server returned from the refused
// attempt, so it cannot be a copy of anything older than the write itself.

interface Flagged { productName: string | null; previousCost: number; nextCost: number; deltaRelative: number }

/** The flags of an attempt. Held so a 409 can be answered without losing what was already decided. */
interface Attempt { override: boolean; reapply: boolean }

export function ApplyBill({
  shipmentId, canApply, canOverride, matchedLines, unmatchedLines, coveragePct, alreadyApplied, appliedAt,
}: {
  shipmentId: string
  canApply: boolean
  /** Coverage, and only coverage — see `overridable` in ../groups.ts. */
  canOverride: boolean
  matchedLines: number
  unmatchedLines: number
  /** FLOORED, by ../groups.ts. Never recomputed here: 99.6% must not read as 100% on the button either. */
  coveragePct: number
  alreadyApplied: boolean
  appliedAt: string | null
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [pending, setPending] = useState<Attempt | null>(null)
  const [flagged, setFlagged] = useState<Flagged[] | null>(null)

  async function apply(attempt: Attempt, acknowledge: boolean) {
    if (busy) return
    setBusy(true); setErr(null)
    try {
      // Built key by key rather than posted as three booleans: the route is .strict() and a `false`
      // is not the same fact as an absence — what the shipment records is what was ASKED FOR.
      const body: Record<string, boolean> = {}
      if (attempt.override) body.override = true
      if (attempt.reapply) body.reapply = true
      if (acknowledge) body.acknowledgeDivergence = true

      const res = await fetch(`/api/invoices/shipments/${shipmentId}/apply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const j = await res.json().catch(() => ({}))
      if (res.status === 409 && j.needsAcknowledgement) {
        setFlagged((j.divergences ?? []) as Flagged[])
        setPending(attempt)
        return
      }
      // The route's own sentence — the RPC's guards come back as words a person can read.
      if (!res.ok || j.ok === false) { setErr(j.error || 'Those costs could not be applied.'); return }
      setPending(null); setFlagged(null)
      router.refresh()
    } catch {
      setErr('Those costs could not be applied — check your connection.')
    } finally {
      setBusy(false)
    }
  }

  const money = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 2 })
  const close = () => { setPending(null); setFlagged(null); setErr(null) }
  const day = (iso: string) => new Date(iso).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' })

  return (
    <>
      {alreadyApplied ? (
        // Re-applying OVERWRITES what the first apply wrote, so it is a different word on a different
        // button — never Apply wearing this one. The date of the earlier apply is the information the
        // owner needs to decide, so it travels into the sheet rather than being left on the slot.
        <button type="button" className="v2-bl-apply" data-again onClick={() => setPending({ override: false, reapply: true })} disabled={busy}>
          <Check />{busy ? 'Applying…' : 'Apply again'}
        </button>
      ) : (
        <button
          type="button"
          className="v2-bl-apply"
          disabled={!canApply || busy}
          onClick={() => setPending({ override: false, reapply: false })}
        >
          <Check />{busy ? 'Applying…' : `Apply to ${matchedLines} ${matchedLines === 1 ? 'line' : 'lines'}`}
        </button>
      )}

      {/* The override. A text button rather than a second block the size of Apply: it is the same act
          at a worse coverage, not a different one, and it must not compete with the gate it is
          stepping around. The percentage is the floored one, so the button cannot flatter the bill it
          is about to apply. */}
      {!canApply && canOverride && !busy && (
        <button type="button" className="v2-bl-over" onClick={() => setPending({ override: true, reapply: false })}>
          {`Apply anyway, at ${coveragePct}% coverage`}
        </button>
      )}

      {(pending || flagged) && (
        <Sheet
          title={flagged ? 'These costs move a margin' : pending?.reapply ? 'Apply these costs again' : pending?.override ? `Apply at ${coveragePct}% coverage` : 'Apply these costs'}
          busy={busy}
          onClose={close}
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
                <button type="button" className="v2-esec" onClick={close} disabled={busy}>Not yet</button>
                {/* The only place acknowledgeDivergence is ever true, and it carries the first
                    attempt's flags with it rather than starting a new, unflagged one. */}
                <button type="button" className="v2-epri" onClick={() => void apply(pending ?? { override: false, reapply: false }, true)} disabled={busy}>
                  {busy ? 'Applying…' : 'I have read these — apply'}
                </button>
              </div>
            </>
          ) : (
            <>
              {pending?.reapply ? (
                <p className="v2-iv-ss">
                  {`This overwrites the shipping and duty on all ${matchedLines} matched ${matchedLines === 1 ? 'product' : 'products'} with the figures on this screen`}
                  {appliedAt ? `, replacing what the apply of ${day(appliedAt)} put there` : ''}
                  {`. A product holds one bill's freight at a time, so this replaces rather than adds. It is not reversible.`}
                </p>
              ) : pending?.override ? (
                <p className="v2-iv-ss">
                  {`Only ${coveragePct}% of this bill is matched. The freight and duty belonging to the `}
                  {`${unmatchedLines} unmatched ${unmatchedLines === 1 ? 'line' : 'lines'} will land on the ${matchedLines} matched `}
                  {`${matchedLines === 1 ? 'product' : 'products'} instead, so those costs will be overstated. It is not reversible.`}
                </p>
              ) : (
                <p className="v2-iv-ss">
                  This writes a landed cost onto every matched product, replacing what is there now.
                  It is not reversible.
                </p>
              )}
              {err && <p className="v2-emsg" data-bad>{err}</p>}
              <div className="v2-eacts">
                <button type="button" className="v2-esec" onClick={close} disabled={busy}>Cancel</button>
                <button type="button" className="v2-epri" onClick={() => void apply(pending!, false)} disabled={busy}>
                  {busy ? 'Applying…' : pending?.reapply ? 'Overwrite' : `Apply to ${matchedLines} ${matchedLines === 1 ? 'line' : 'lines'}`}
                </button>
              </div>
            </>
          )}
        </Sheet>
      )}
    </>
  )
}
