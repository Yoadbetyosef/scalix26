'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Lock } from 'lucide-react'
import {
  boardColumnLabel, canManualTransition, isProtectedStage, type OrderStage,
} from '@/lib/orders/stages'
import { stageColor, stageHue, STAGE_COLUMN_WIDTH } from '@/lib/orders/stage-colors'

// THE BOARD, DRAGGABLE.
//
// ── NO LIBRARY ──────────────────────────────────────────────────────────────────────────────────
//
// dnd-kit and react-beautiful-dnd both do this well and neither is a dependency of this project. The
// whole requirement is "pick a card up, drop it on a column" — one drag source, a few drop targets,
// no sorting within a column, no virtualisation, no nesting. That is what the HTML5 drag-and-drop
// API is for, and it is already in every browser.
//
// ── WHAT THE HTML5 API DOES NOT DO, SAID PLAINLY ────────────────────────────────────────────────
//
// It does not fire on touch. There is no dragstart from a finger on iOS or Android, and no amount of
// care here changes that — it is the API, not the implementation. So the board is a desktop tool, and
// the buttons on the order page remain the way a stage moves on a phone. Those buttons are not a
// fallback that happens to exist; they are the same transition through the same route, which is why
// this can ship without them being rebuilt.
//
// If touch dragging is wanted later it needs a pointer-events implementation or a library, and that
// is a real decision to make rather than something to slip in here.
//
// ── IT REUSES THE TRANSITION, IT DOES NOT REPEAT IT ─────────────────────────────────────────────
//
// Dropping a card POSTs the same /api/orders/[id]/stage the buttons post, which calls setStageManual,
// which asks canManualTransition. So there is exactly one state machine and the board cannot drift
// from it. The only thing decided here is whether a column will ACCEPT a card — and that is the same
// predicate, imported, not a second copy of the rules.

export interface BoardCard {
  id: string
  orderNumber: string
  customerName: string | null
  customerCompany?: string | null
  factoryName: string | null
  subtotalCents: number
  stage: OrderStage
}

const money = (c: number) => `$${(c / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}`

export function BoardColumns({ stages, cards }: { stages: OrderStage[]; cards: BoardCard[] }) {
  const router = useRouter()
  // The card being dragged. Held as the whole card, not just an id, because every column needs its
  // ORIGIN stage to decide whether it may accept the drop.
  const [dragging, setDragging] = useState<BoardCard | null>(null)
  const [over, setOver] = useState<OrderStage | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  /** Optimistic, so the card moves under the cursor rather than after a round trip. */
  const [moved, setMoved] = useState<Record<string, OrderStage>>({})
  const stageOf = (c: BoardCard): OrderStage => moved[c.id] ?? c.stage

  const accepts = (to: OrderStage): boolean =>
    dragging !== null && canManualTransition(stageOf(dragging), to)

  const drop = async (to: OrderStage) => {
    const card = dragging
    setDragging(null); setOver(null)
    if (!card || !canManualTransition(stageOf(card), to)) return

    const from = stageOf(card)
    setMoved((p) => ({ ...p, [card.id]: to }))
    setBusy(true); setErr(null)
    try {
      const r = await fetch(`/api/orders/${card.id}/stage`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ toStage: to }),
      })
      if (!r.ok) {
        // PUT IT BACK. An optimistic move that fails and stays put is a board that lies — and the
        // most likely failure here is precisely the one that has been biting: the database has not
        // been told about the stage yet, so the write is refused and the card must not appear to
        // have moved. The message is the store's, which names the migration.
        setMoved((p) => ({ ...p, [card.id]: from }))
        throw new Error((await r.json().catch(() => ({}))).error || 'That move was refused.')
      }
      router.refresh()
    } catch (e) {
      setErr((e as Error).message)
    } finally { setBusy(false) }
  }

  return (
    <>
      {err && (
        <div className="v2-notice" style={{ ['--ghue' as string]: 'var(--v2-t4)', marginBottom: 12 }}>
          <p>{err}</p>
        </div>
      )}

      <div className="flex gap-3 overflow-x-auto pb-4">
        {stages.map((s) => {
          const c = stageColor(s)
          const rows = cards.filter((o) => stageOf(o) === s)
          // Three states, and they have to be distinguishable: nothing is being dragged; something is
          // being dragged that this column would take; something is being dragged that it would not.
          const willTake = accepts(s)
          const refuses = dragging !== null && !willTake && stageOf(dragging) !== s
          return (
            <div
              key={s}
              className={`${STAGE_COLUMN_WIDTH} shrink-0 overflow-hidden`}
              onDragOver={(e) => {
                // preventDefault is what MAKES a element a drop target. Without it the browser
                // refuses every drop and nothing reports why.
                if (!willTake) return
                e.preventDefault()
                e.dataTransfer.dropEffect = 'move'
                if (over !== s) setOver(s)
              }}
              onDragLeave={() => setOver((o) => (o === s ? null : o))}
              onDrop={(e) => { e.preventDefault(); void drop(s) }}
              style={{
                border: `1px solid ${over === s ? c.bar : 'var(--v2-line)'}`,
                borderRadius: 'var(--v2-radius-card)',
                background: 'var(--v2-paper)',
                // The column being hovered lifts; a column that would refuse the card recedes, so the
                // legal targets are the ones that stand out rather than the ones that are labelled.
                boxShadow: over === s ? `0 0 0 2px ${c.bg}` : undefined,
                opacity: refuses ? 0.45 : 1,
                transition: 'opacity 120ms ease, box-shadow 120ms ease, border-color 120ms ease',
              }}
            >
              <div className="flex items-center justify-between gap-2 px-3 py-2.5"
                   style={{ background: c.bg, borderBottom: `1px solid ${c.border}` }}>
                <span className="v2-kick" style={{ color: c.text, whiteSpace: 'nowrap' }}>{boardColumnLabel(s)}</span>
                <span className="flex shrink-0 items-center gap-1.5">
                  <span className="v2-kick" style={{ color: c.text, opacity: 0.8 }}>{rows.length}</span>
                  {isProtectedStage(s) && (
                    <Lock aria-label="Approval stage — moves via workflow actions only"
                          style={{ width: 11, height: 11, color: c.text, opacity: 0.7 }} />
                  )}
                </span>
              </div>
              <div className="v2-list">
                {rows.map((o) => (
                  <Link
                    key={o.id} href={`/orders/${o.id}`} className="v2-row" data-click
                    // draggable on the anchor: a link is already keyboard-reachable and already the
                    // way into the order, so the card keeps both behaviours rather than becoming a
                    // div that has to re-earn them.
                    draggable={!busy}
                    onDragStart={(e) => {
                      setDragging(o)
                      e.dataTransfer.effectAllowed = 'move'
                      // Firefox will not start a drag without data set on the transfer. The id is
                      // the payload of record; `dragging` above is what the columns actually read.
                      e.dataTransfer.setData('text/plain', o.id)
                    }}
                    onDragEnd={() => { setDragging(null); setOver(null) }}
                    style={{
                      ['--chan' as string]: stageHue(s),
                      padding: '11px 13px',
                      cursor: busy ? 'progress' : 'grab',
                      opacity: dragging?.id === o.id ? 0.4 : 1,
                    }}
                  >
                    <div className="v2-m">
                      {/* The firm when there is one — a B2B card that says "Irina" and not which
                          yacht centre is a card she has to open to identify. */}
                      <p className="truncate">{o.customerCompany || o.customerName || 'No customer'}</p>
                      <span style={{ fontFamily: 'var(--v2-mono)', fontSize: 11 }}>
                        {o.orderNumber} · {money(o.subtotalCents)}{o.factoryName ? ` · ${o.factoryName}` : ''}
                      </span>
                    </div>
                  </Link>
                ))}
                {rows.length === 0 && (
                  <p className="v2-kick" style={{ padding: '14px 13px' }}>
                    {willTake ? 'Drop here' : 'Nothing here'}
                  </p>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </>
  )
}
