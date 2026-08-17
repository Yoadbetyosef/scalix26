'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Sheet } from '../../form-sheet'

// PICKING THE PRODUCT AN INVOICE LINE REFERS TO.
//
// Built here rather than linked to /landed-cost, which is the same screen in the old app. A row in /v2
// that leaves for /v2's predecessor is a dead end in one tap on a phone — see no-escape.test.ts, which
// fails the build for it. It is also the only action on this screen that can move a bill above the
// coverage gate, so without it the review screen is a picture of itself.
//
// ── EVERY MATCH RE-RUNS THE WHOLE ALLOCATION ────────────────────────────────────────────────────
//
// Freight is spread across matched lines, so matching ONE line changes every other line's share. The
// route returns the whole shipment for exactly that reason, and this refreshes the server component
// rather than patching a row: a screen that updated one line locally would be showing an allocation
// that no longer sums to what was paid.
//
// ── SET ASIDE IS NOT THE SAME AS UNMATCHED ──────────────────────────────────────────────────────
//
// "We could not find it" is a problem the owner can fix. "This is not something we stock" is a
// decision already made. Both leave the allocation denominator, and only one of them should keep
// asking. That is why Set aside is here and not a way of dismissing the row.

interface Suggestion { id: string; name: string; sku: string | null }

export function MatchLine({
  lineId, description,
}: { lineId: string; description: string }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [suggestions, setSuggestions] = useState<Suggestion[] | null>(null)
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<Suggestion[]>([])

  // The pipeline's own shortlist — the same scorer that produced the automatic matches, so the
  // owner is choosing between the candidates it was choosing between.
  useEffect(() => {
    if (!open) return
    let cancelled = false
    ;(async () => {
      try {
        const r = await fetch(`/api/invoices/lines/${lineId}`)
        const j = await r.json().catch(() => ({}))
        if (!cancelled) setSuggestions((j.suggestions ?? []) as Suggestion[])
      } catch {
        if (!cancelled) setSuggestions([])
      }
    })()
    return () => { cancelled = true }
  }, [open, lineId])

  // Typing runs the SAME scorer against what was typed — `?q=` on the same route — because the
  // shortlist is only as good as the description the document carried, and some carry a supplier's
  // own code and nothing else. Not a different search: a product that ranks first when typed and
  // fourth when suggested is two matchers disagreeing in front of the owner.
  useEffect(() => {
    if (!open || q.trim().length < 2) { setHits([]); return }
    let cancelled = false
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/api/invoices/lines/${lineId}?q=${encodeURIComponent(q.trim())}`)
        const j = await r.json().catch(() => ({}))
        if (!cancelled) setHits(((j.suggestions ?? []) as Suggestion[]).slice(0, 6))
      } catch { /* a failed lookup must never block the shortlist below it */ }
    }, 200)
    return () => { cancelled = true; clearTimeout(t) }
  }, [q, open, lineId])

  function close() { setOpen(false); setBusy(false); setErr(null); setQ(''); setHits([]); setSuggestions(null) }

  async function choose(productId: string | null, skip = false) {
    if (busy) return
    setBusy(true); setErr(null)
    try {
      const res = await fetch(`/api/invoices/lines/${lineId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productId, skip }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) { setErr(j.error || 'That did not save.'); return }
      close()
      // The whole screen, not the row — the allocation moved underneath every other line.
      router.refresh()
    } catch {
      setErr('That did not save — check your connection.')
    } finally {
      setBusy(false)
    }
  }

  const shown = q.trim().length >= 2 ? hits : (suggestions ?? [])

  return (
    <>
      <button type="button" className="v2-bl-fix" onClick={() => setOpen(true)}>Pick a product</button>

      {open && (
        <Sheet title="Which product is this?" busy={busy} onClose={close}>
          <p className="v2-iv-ss">{description}</p>

          <label className="v2-efield">
            <span>Search your catalog</span>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name or SKU" disabled={busy} />
          </label>

          {suggestions === null && q.trim().length < 2 && <p className="v2-ehint">Looking for close matches…</p>}

          {shown.length > 0 ? (
            <div className="v2-ap-hits">
              {shown.map((s) => (
                <button key={s.id} type="button" onClick={() => void choose(s.id)} disabled={busy}>
                  <b>{s.name}</b><span>{s.sku || 'No SKU'}</span>
                </button>
              ))}
            </div>
          ) : (
            suggestions !== null && (
              <p className="v2-ehint">
                {q.trim().length >= 2 ? 'Nothing in your catalog matches that.' : 'No close match was found for this line.'}
              </p>
            )
          )}

          {err && <p className="v2-emsg" data-bad>{err}</p>}

          {/* A DECISION, not a dismissal. It stays in the allocation denominator and stops being asked
              about, which is the whole difference between "not ours" and "not found". */}
          <div className="v2-eacts">
            <button type="button" className="v2-esec" onClick={() => void choose(null, true)} disabled={busy}>
              We don&apos;t stock this
            </button>
            <button type="button" className="v2-esec" onClick={close} disabled={busy}>Cancel</button>
          </div>
        </Sheet>
      )}
    </>
  )
}
