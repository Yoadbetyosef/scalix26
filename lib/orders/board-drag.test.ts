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
    expect(c).toMatch(/if \(!card \|\| !canManualTransition/)
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

  it('coming back from pending resumes rather than advances', () => {
    // Back to 'new', the same single honest move out of a no-sale. Anything else would be the board
    // guessing where a parked job had got to.
    expect(canManualTransition('pending', 'new')).toBe(true)
    for (const s of ORDER_STAGES) {
      if (['new', 'pending', 'cancelled', 'finished', 'closed_no_sale'].includes(s)) continue
      expect(canManualTransition('pending', s), s).toBe(false)
    }
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
