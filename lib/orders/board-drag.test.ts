import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import {
  ORDER_STAGES, canManualTransition, hasNoBoardColumn, isProtectedStage,
  boardColumnLabel, isPendingStage, isTerminalStage, isAtRestStage, type OrderStage,
} from './stages'

// THE BOARD MOVES A CARD THROUGH THE STATE MACHINE, NOT AROUND IT.
//
// A drag is a stage transition. The one thing that must never happen is the board growing its own
// idea of which moves are legal — two rule sets that agree on the day they are written and diverge
// the first time either is edited, with the board being the one nobody re-reads.

const read = (f: string) => readFileSync(f, 'utf8')
const code = (f: string) => read(f).replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ')

const BOARD = 'components/orders/board-columns.tsx'
const PAGE = 'app/orders/board/page.tsx'

describe('the drag reuses the existing transition', () => {
  it('posts to the same route the stage buttons post to', () => {
    const c = code(BOARD)
    expect(c).toMatch(/\/api\/orders\/\$\{card\.id\}\/stage/)
    expect(c).toMatch(/toStage: to/)
  })

  it('asks canManualTransition rather than listing moves of its own', () => {
    const c = code(BOARD)
    expect(c).toMatch(/canManualTransition/)
    // The shapes a second rule set would take: a hand-written map of stages, or stage names compared
    // inline to decide a move.
    expect(c).not.toMatch(/MANUAL_FORWARD|ALLOWED_MOVES|TRANSITIONS\s*[:=]/)
  })

  it('refuses the drop client-side AND lets the server refuse it too', () => {
    const c = code(BOARD)
    // Checked before the fetch, so an illegal column never lights up...
    expect(c).toMatch(/if \(!canManualTransition\(stageOf\(card\), to\)\) return/)
    // ...and the response is still checked, because the client's copy of the rules is a convenience
    // and the server's is the authority. setStageManual re-asks the same predicate.
    expect(c).toMatch(/if \(!r\.ok\)/)
    expect(code('lib/orders/store.ts')).toMatch(/if \(!canManualTransition\(from, to\)\) return \{ ok: false/)
  })

  it('puts an optimistically moved card back when the write is refused', () => {
    // The likeliest refusal is the one that has been happening: the database does not know the stage
    // yet, so it answers 23514. A card that stayed in the new column would be the board claiming a
    // move the database rejected.
    expect(code(BOARD)).toMatch(/setMoved\(\(p\) => \(\{ \.\.\.p, \[card\.id\]: from \}\)\)/)
  })
})

describe('the two new columns', () => {
  it('pending is a column, and it is work rather than an ending', () => {
    expect(ORDER_STAGES).toContain('pending')
    expect(hasNoBoardColumn('pending')).toBe(false)
    expect(isPendingStage('pending')).toBe(true)
    // Parked is not lost and not finished. If it were either, it would belong in a pile that is
    // already on the board.
    expect(isTerminalStage('pending')).toBe(false)
    expect(isAtRestStage('pending')).toBe(false)
    // Not an approval stage: she parks a job herself, it is not something a recipient does.
    expect(isProtectedStage('pending')).toBe(false)
  })

  it('lost business is a column, headed by what the pile is', () => {
    expect(hasNoBoardColumn('closed_no_sale')).toBe(false)
    expect(boardColumnLabel('closed_no_sale')).toBe('Lost business')
  })

  it('a job can be parked from anywhere it is still live, including production', () => {
    // A piece waiting on a stone is the commonest reason to park one, so the in-flight exclusion that
    // rightly applies to a no-sale would rule out the main case.
    for (const s of ['new', 'production', 'ready', 'delivered', 'waiting_customer_approval'] as OrderStage[]) {
      expect(canManualTransition(s, 'pending'), s).toBe(true)
    }
  })

  it('a job cannot be parked from an ending, or from a no-sale, or from itself', () => {
    for (const s of ['completed', 'finished', 'cancelled', 'closed_no_sale', 'pending'] as OrderStage[]) {
      expect(canManualTransition(s, 'pending'), s).toBe(false)
    }
  })

  it('coming back from pending resumes wherever the job actually is', () => {
    // It used to be 'new' only — the board refusing to guess where a parked job had got to. Now the
    // person dragging it says where, which is the same freedom every other live stage has.
    expect(canManualTransition('pending', 'new')).toBe(true)
    expect(canManualTransition('pending', 'production')).toBe(true)
    expect(canManualTransition('pending', 'waiting_customer_approval')).toBe(true)
  })

  it('a parked job can still be lost, cancelled or finished', () => {
    // It is live, so the three endings stay reachable — parking must not become a trap that has to be
    // un-parked first.
    for (const s of ['closed_no_sale', 'cancelled', 'finished'] as OrderStage[]) {
      expect(canManualTransition('pending', s), s).toBe(true)
    }
  })
})

describe('the board hands the client a projection, not an order', () => {
  it('never passes internal cost or internal notes across the boundary', () => {
    const c = code(PAGE)
    expect(c).not.toMatch(/internalCost|internalNotes/)
    // Built field by field, so a column added to Order later cannot arrive here by accident.
    expect(c).toMatch(/const cards: BoardCard\[\]/)
  })

  it('still decides its columns from the shared predicate', () => {
    expect(code(PAGE)).toMatch(/hasNoBoardColumn\(s\)/)
  })
})

// ── ANY COLUMN, EITHER WAY, ON THE RECORD ───────────────────────────────────────────────────────
describe('the board moves a job anywhere it may honestly go, and every move is on the timeline', () => {
  it('a drop between any two live columns is accepted client-side by the same predicate the server uses', () => {
    expect(canManualTransition('production', 'customer_changes_requested')).toBe(true) // back to revisions
    expect(canManualTransition('waiting_factory_approval', 'production')).toBe(true)   // straight to production
    expect(canManualTransition('customer_changes_requested', 'production')).toBe(true) // and forward again
  })
  it('closed columns take a drop but do not give one up — Reopen is on the order page', () => {
    expect(canManualTransition('delivered', 'completed')).toBe(true)
    expect(canManualTransition('completed', 'production')).toBe(false)
    expect(code(BOARD)).toMatch(/draggable=\{!busy && isLiveStage\(stageOf\(o\)\)\}/)
  })
  it('a phone gets a move menu on every live card, posting the same route', () => {
    const c = code(BOARD)
    expect(c).toMatch(/<select[\s\S]*?onChange=\{\(e\) => \{ const to = e\.target\.value as OrderStage; if \(to\) void moveCard\(o, to\) \}\}/)
    expect(c).toMatch(/const moveCard = async \(card: BoardCard, to: OrderStage\)/)
    expect(c).not.toMatch(/<Lock/)
  })
  it('the stage route takes a reason and the store writes it beside from, to and who', () => {
    expect(code('app/api/orders/[id]/stage/route.ts')).toMatch(/note: z\.string\(\)\.max\(500\)\.nullable\(\)\.optional\(\)/)
    expect(code('lib/orders/store.ts')).toMatch(/\.\.\.\(reason \? \{ note: reason \} : \{\}\)/)
    // And the page prints from → to — reason, with a name rather than a uuid.
    const page = code('app/orders/[id]/page.tsx')
    expect(page).toMatch(/case 'stage_changed': return `\$\{p\.from \? `\$\{stage\(p\.from\)\} → ` : ''\}\$\{stage\(p\.to\)\}\$\{p\.note \? ` — \$\{p\.note\}` : ''\}`/)
    expect(page).toMatch(/actorLabel\(labels, e\.actor\)/)
  })
})
