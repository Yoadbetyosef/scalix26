import { describe, it, expect } from 'vitest'
import {
  ORDER_STAGES, STAGE_LABELS, canManualTransition, isTerminalStage, isAtRestStage,
  hasNoBoardColumn, canEditWorkflow, boardColumnLabel, type OrderStage,
} from './stages'

// "CLOSED – NO SALE": the estimate the customer didn't take.
//
// TG writes ~30 a day and a handful convert. The rest are neither cancelled work nor finished work,
// and the customer comes back — so this stage exists to be LEFT, which is what separates it from the
// three that came before it.
describe('closed_no_sale', () => {
  it('is a stage, with the label the business uses for it', () => {
    expect(ORDER_STAGES).toContain('closed_no_sale')
    expect(STAGE_LABELS.closed_no_sale).toBe('Closed – No Sale')
  })

  it('is NOT terminal — that is the entire point', () => {
    // Everything else about it looks terminal; this is the one property that must not be.
    expect(isTerminalStage('closed_no_sale')).toBe(false)
    expect(isAtRestStage('closed_no_sale')).toBe(true)
  })

  it('reopens, and only back to new', () => {
    expect(canManualTransition('closed_no_sale', 'new')).toBe(true)
    // Coming back is not progress. Reopening restores the estimate; it does not advance it.
    for (const s of ORDER_STAGES) {
      if (s === 'new' || s === 'closed_no_sale') continue
      expect(canManualTransition('closed_no_sale', s)).toBe(false)
    }
  })

  it('can be closed from a live estimate but never from a piece already being made', () => {
    expect(canManualTransition('new', 'closed_no_sale')).toBe(true)
    expect(canManualTransition('waiting_customer_approval', 'closed_no_sale')).toBe(true)
    // An order in production that the customer walks away from is a cancellation, with a factory to
    // tell. Filing that under "they never bought" would lose the fact that work was done.
    for (const s of ['production', 'ready', 'delivered'] as OrderStage[]) {
      expect(canManualTransition(s, 'closed_no_sale')).toBe(false)
    }
  })

  it('cannot be reached from a stage that is already over', () => {
    for (const s of ['completed', 'finished', 'cancelled'] as OrderStage[]) {
      expect(canManualTransition(s, 'closed_no_sale')).toBe(false)
    }
    // And it does not loop back onto itself.
    expect(canManualTransition('closed_no_sale', 'closed_no_sale')).toBe(false)
  })

  it('stays editable, because a customer who returns usually wants a change', () => {
    // The terminal three lock the workflow editor. An estimate you cannot edit is one you retype.
    expect(canEditWorkflow('closed_no_sale')).toBe(true)
  })

  it('now KEEPS a board column, as "Lost business"', () => {
    // ── THIS ASSERTION WAS THE OPPOSITE, AND THE REVERSAL IS DELIBERATE ─────────────────────────
    //
    // The original reasoning was that ~30 no-sales a day would grow a column nobody could work from.
    // True of a column you have to read; false of one you can drag INTO, which is what the board
    // gained. Closing an estimate as lost is now the commonest thing the board is used for, and it
    // was the one outcome with nowhere to drop a card.
    //
    // Cancelled and finished stay off: those are genuinely one-way, and neither is a drag target.
    expect(hasNoBoardColumn('closed_no_sale')).toBe(false)
    expect(hasNoBoardColumn('cancelled')).toBe(true)
    expect(hasNoBoardColumn('finished')).toBe(true)
    // 'completed' is terminal AND keeps its column — it is the end of the forward chain and the drag
    // target out of 'delivered'. A predicate built on isTerminalStage would have removed it.
    expect(hasNoBoardColumn('completed')).toBe(false)
  })

  it('is headed by what the pile IS, not by the action that made it', () => {
    // "Closed – No Sale" is right on a button and in a timeline. As a standing column heading it is a
    // negative sentence; the column says what is in it.
    expect(boardColumnLabel('closed_no_sale')).toBe('Lost business')
    // Everything without an override still uses its own label, so the map cannot silently rename a
    // stage nobody meant to rename.
    expect(boardColumnLabel('production')).toBe(STAGE_LABELS.production)
  })

  it('does not resurrect the bare word "closed", which was deliberately retired', () => {
    // add_order_closed_stage.sql added 'closed'; add_order_finished_stage.sql removed it hours later
    // on the rule that two words for one state is the thing worth avoiding. 'closed_no_sale' is a
    // different STATE, not a second name for 'finished' — but the bare word stays gone.
    expect(ORDER_STAGES).not.toContain('closed')
  })
})
