import { describe, it, expect } from 'vitest'
import { canManualTransition, canSendForApproval, stageAfterSend, stageAfterResponse, respondableStage, canSendToProduction, isProtectedStage, isTerminalStage, ORDER_STAGES, STAGE_LABELS } from './stages'
import { orderNumberFromBytes, generateOrderNumber } from './order-number'

describe('Order stage state machine', () => {
  it('never allows manual drag into or between protected approval stages', () => {
    const protectedStages = ORDER_STAGES.filter(isProtectedStage)
    for (const to of protectedStages) for (const from of ORDER_STAGES) expect(canManualTransition(from, to)).toBe(false)
    expect(canManualTransition('new', 'waiting_factory_approval')).toBe(false) // must use Send action
    expect(canManualTransition('factory_approved', 'waiting_customer_approval')).toBe(false)
  })
  it('allows manual forward moves only along production → ready → delivered → completed', () => {
    expect(canManualTransition('production', 'ready')).toBe(true)
    expect(canManualTransition('ready', 'delivered')).toBe(true)
    expect(canManualTransition('delivered', 'completed')).toBe(true)
    expect(canManualTransition('production', 'completed')).toBe(false) // no skipping
    expect(canManualTransition('completed', 'production')).toBe(false) // terminal
  })
  it('allows cancel from any non-terminal stage', () => {
    expect(canManualTransition('new', 'cancelled')).toBe(true)
    expect(canManualTransition('production', 'cancelled')).toBe(true)
    expect(canManualTransition('completed', 'cancelled')).toBe(false)
    expect(canManualTransition('cancelled', 'cancelled')).toBe(false)
  })

  it('send-for-approval works in EITHER order — neither approval is a prerequisite', () => {
    expect(canSendForApproval('new', 'factory')).toBe(true)
    expect(canSendForApproval('factory_changes_requested', 'factory')).toBe(true)

    // This assertion used to read `false`, with the comment "must get factory approval first". That
    // encoded a sequence the business does not have: sometimes the customer approves the estimate
    // before anything reaches a workshop. The old gate hid the Send to Customer button on exactly the
    // orders where it was wanted.
    expect(canSendForApproval('new', 'customer')).toBe(true)
    expect(canSendForApproval('factory_approved', 'customer')).toBe(true)

    // Both may be outstanding at once — that is the point of the change.
    expect(canSendForApproval('waiting_customer_approval', 'factory')).toBe(true)
    expect(canSendForApproval('waiting_factory_approval', 'customer')).toBe(true)

    // But not a DUPLICATE of one already in flight.
    expect(canSendForApproval('waiting_factory_approval', 'factory')).toBe(false)
    expect(canSendForApproval('waiting_customer_approval', 'customer')).toBe(false)

    // And never once the piece is being made, delivered, finished or cancelled.
    for (const s of ['production', 'ready', 'delivered', 'completed', 'cancelled'] as const) {
      expect(canSendForApproval(s, 'factory')).toBe(false)
      expect(canSendForApproval(s, 'customer')).toBe(false)
    }

    expect(stageAfterSend('factory')).toBe('waiting_factory_approval')
    expect(stageAfterSend('customer')).toBe('waiting_customer_approval')
  })

  it('responses map to the correct resulting stage and are only valid from the waiting stage', () => {
    expect(stageAfterResponse('factory', 'approved')).toBe('factory_approved')
    expect(stageAfterResponse('factory', 'changes_requested')).toBe('factory_changes_requested')
    expect(stageAfterResponse('factory', 'rejected')).toBe('factory_changes_requested')
    expect(stageAfterResponse('customer', 'approved')).toBe('customer_approved')
    expect(respondableStage('factory')).toBe('waiting_factory_approval')
    expect(respondableStage('customer')).toBe('waiting_customer_approval')
  })

  it('production is never automatic — only via the explicit action, from customer OR factory approved', () => {
    expect(canSendToProduction('customer_approved')).toBe(true)
    expect(canSendToProduction('factory_approved')).toBe(true) // may skip customer approval
    expect(canSendToProduction('customer_changes_requested')).toBe(false)
    expect(canSendToProduction('new')).toBe(false)
    expect(canSendToProduction('waiting_factory_approval')).toBe(false)
    expect(canManualTransition('customer_approved', 'production')).toBe(false) // not via drag
  })
})

describe('Order number (non-sequential, unguessable)', () => {
  it('formats Crockford base32 with an ORD- prefix and no ambiguous chars', () => {
    const n = orderNumberFromBytes(new Uint8Array([0, 33, 66, 99, 132, 165, 198, 231]))
    expect(n).toMatch(/^ORD-[0-9A-HJKMNP-TV-Z]{8}$/)
    expect(n.slice(4)).not.toMatch(/[ILOU]/) // random suffix excludes ambiguous I, L, O, U
  })
  it('generateOrderNumber produces varied, non-sequential values', () => {
    const a = generateOrderNumber(), b = generateOrderNumber()
    expect(a).toMatch(/^ORD-/)
    expect(a).not.toBe(b) // effectively never equal
  })
})

describe('closing a job, without claiming it was produced', () => {
  it('is reachable from every non-terminal stage, including new', () => {
    // The fault: from 'new' the only manual move was Cancel, so recording a finished repair meant
    // cancelling it or marching it through factory approval into production first.
    for (const s of ORDER_STAGES) {
      if (isTerminalStage(s)) continue
      expect(canManualTransition(s, 'closed'), s).toBe(true)
    }
  })

  it('and nothing moves out of it', () => {
    // A closed job that can be dragged back into production is not closed.
    expect(isTerminalStage('closed')).toBe(true)
    for (const s of ORDER_STAGES) expect(canManualTransition('closed', s), s).toBe(false)
  })

  it('is NOT completed — the board must not claim production that did not happen', () => {
    expect(STAGE_LABELS.closed).toBe('Closed')
    expect(STAGE_LABELS.completed).toBe('Completed')
    // The forward chain still ends at completed; closed is not on it.
    expect(canManualTransition('delivered', 'completed')).toBe(true)
    expect(canManualTransition('new', 'completed')).toBe(false)
  })

  it('does not open an approval stage as a side effect', () => {
    for (const s of ORDER_STAGES) {
      if (isProtectedStage(s)) expect(canManualTransition('new', s), s).toBe(false)
    }
    expect(canSendForApproval('closed', 'factory')).toBe(false)
    expect(canSendForApproval('closed', 'customer')).toBe(false)
  })
})
