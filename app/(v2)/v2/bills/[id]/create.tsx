'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Sheet } from '../../form-sheet'

// TURNING INVOICE LINES INTO PRODUCTS.
//
// For a business setting up from scratch the invoices ARE the catalogue, and this is the control that
// lets one become the other. It is not a nicety on this screen — it is the only way a bill can reach
// coverage when there is nothing in the catalogue to match against. The applied PRIMAVERA bill was
// costed this way: 126 of its 133 lines carry match_method = 'created', which means the products on
// them exist because somebody ticked them here.
//
// ── NOT A ONE-CLICK "CREATE ALL" ────────────────────────────────────────────────────────────────
//
// v1's rule, kept: the owner selects which lines, and may rename each one first. A catalogue full of
// rows nobody chose still has to be cleaned by hand afterwards, and this is the one moment the
// supplier's description and its price are both in front of them. Select all is offered because
// "every line on this invoice is new" is a real and common answer — but it is a press, not a default.
//
// The name defaults to the raw description, UNEDITED. The supplier's shorthand is better evidence
// than our title-casing, and their next invoice matches this product on the SKU we keep beside it
// rather than creating a second copy of it.
//
// ── A SHEET, WHERE v1 PUTS CHECKBOXES DOWN THE PAGE ─────────────────────────────────────────────
//
// The one place this is not v1's shape. v1 is a desktop screen and can afford a checkbox and a name
// field on every row; 133 of those down a phone, with a floating bar underneath, is not the same
// control. What the sheet has to preserve is the REASON v1 put the fields on the rows — that the
// description and the money are in front of the person naming the thing — so both travel into it.

interface Line { id: string; description: string | null; sku: string | null; lineNo: number; amount: string; qty: string | null }

/** The route's own ceiling. Selecting past it would come back as an unreadable 400. */
const MAX_AT_ONCE = 500

export function CreateProducts({ lines }: { lines: Line[] }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  // Lines the owner has ticked, and any name they retyped first. Kept together rather than per-row so
  // "create these six" is one request and one recomputed allocation.
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [names, setNames] = useState<Record<string, string>>({})

  const label = (l: Line) => l.description || l.sku || `Line ${l.lineNo}`

  function close() { setOpen(false); setBusy(false); setErr(null); setPicked(new Set()); setNames({}) }

  async function create() {
    if (busy || picked.size === 0) return
    setBusy(true); setErr(null)
    try {
      const res = await fetch('/api/invoices/lines/create-products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // Only the names that were TYPED. An absent one means the raw description, which the server
        // reads off the line itself — sending our copy of it would let a stale screen rename a line.
        body: JSON.stringify({ lineIds: [...picked], names }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) { setErr(j.error || 'Those products could not be created.'); return }
      close()
      // The whole screen: every line that just became matched moves every other line's share.
      router.refresh()
    } catch {
      setErr('Those products could not be created — check your connection.')
    } finally {
      setBusy(false)
    }
  }

  const tooMany = picked.size > MAX_AT_ONCE

  return (
    <>
      <div className="v2-bl-mkbar">
        <p>
          <b>{lines.length} {lines.length === 1 ? 'line' : 'lines'} matched nothing in your catalogue.</b>{' '}
          If these are goods you do not have yet, create them from the invoice — each one gets its cost
          and no selling price, so it is never quoted until you price it.
        </p>
        <button type="button" className="v2-bl-fix" onClick={() => setOpen(true)}>Create products</button>
      </div>

      {open && (
        <Sheet title="Which lines are new products?" wide busy={busy} onClose={close}>
          <p className="v2-iv-ss">
            Ticked lines become draft products, named as you leave them here. Their SKU is kept as the
            supplier wrote it, so the next invoice from them matches these instead of making more.
          </p>

          <div className="v2-bl-mkall">
            <span>{picked.size === 0 ? `${lines.length} unmatched` : `${picked.size} selected`}</span>
            <button
              type="button"
              onClick={() => setPicked(picked.size === lines.length ? new Set() : new Set(lines.map((l) => l.id)))}
              disabled={busy}
            >
              {picked.size === lines.length ? 'Clear' : `Select all ${lines.length}`}
            </button>
          </div>

          <div className="v2-bl-mklist">
            {lines.map((l) => {
              const on = picked.has(l.id)
              return (
                <div className="v2-bl-mkrow" key={l.id} data-on={on || undefined}>
                  <label className="v2-bl-mkpick">
                    <input
                      type="checkbox" checked={on} disabled={busy}
                      aria-label={`Create a product from ${label(l)}`}
                      onChange={(e) => setPicked((p) => {
                        const n = new Set(p)
                        if (e.target.checked) n.add(l.id); else n.delete(l.id)
                        return n
                      })}
                    />
                  </label>
                  <div className="v2-bl-mkmid">
                    {/* The money stays on the row whether or not it is ticked: it is what the person
                        is deciding WITH, not a detail of the decision. */}
                    <p className="v2-bl-mknm">{label(l)}</p>
                    <p className="v2-bl-mkmeta">
                      {[l.sku && `SKU ${l.sku}`, l.qty, l.amount].filter(Boolean).join(' · ')}
                    </p>
                    {on && (
                      <input
                        className="v2-bl-mkname"
                        value={names[l.id] ?? l.description ?? ''}
                        disabled={busy}
                        aria-label={`Name for ${label(l)}`}
                        onChange={(e) => setNames((n) => ({ ...n, [l.id]: e.target.value }))}
                      />
                    )}
                  </div>
                </div>
              )
            })}
          </div>

          {tooMany && <p className="v2-emsg" data-bad>{`Create up to ${MAX_AT_ONCE} at a time — untick ${picked.size - MAX_AT_ONCE}.`}</p>}
          {err && <p className="v2-emsg" data-bad>{err}</p>}

          <div className="v2-eacts">
            <button type="button" className="v2-esec" onClick={close} disabled={busy}>Cancel</button>
            <button type="button" className="v2-epri" onClick={() => void create()} disabled={busy || picked.size === 0 || tooMany}>
              {busy ? 'Creating…' : `Create ${picked.size || ''} ${picked.size === 1 ? 'product' : 'products'}`.replace('  ', ' ')}
            </button>
          </div>
        </Sheet>
      )}
    </>
  )
}
