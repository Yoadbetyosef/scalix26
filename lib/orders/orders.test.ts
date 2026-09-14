import { describe, it, expect } from 'vitest'
import { canManualTransition, canSendForApproval, stageAfterSend, stageAfterResponse, respondableStage, canSendToProduction, isTerminalStage, isAtRestStage, canEditWorkflow, canEditDocumentFacts,
  DOCUMENT_FACT_FIELDS, refusedFields, ORDER_STAGES, STAGE_LABELS, isLiveStage, canReopen, REOPEN_TARGET, orderStatusGroup, STATUS_GROUP_LABELS, isOpenOrder } from './stages'
import { orderNumberFromBytes, generateOrderNumber } from './order-number'

describe('Order stage state machine', () => {
  // ── THE RULE CHANGED, AND THE TESTS SAY WHAT IT IS NOW ─────────────────────────────────────────
  //
  // This block used to assert a forward chain (production → ready → delivered → completed) with the
  // approval stages sealed off from any manual move. That rule described what the software allowed,
  // not what happens in a workshop — a piece in production comes back to revisions, a trade order
  // skips approval entirely — and it is what "cards can only move to the next column" was. The rule
  // is now about what a stage MEANS: live stages are freely reachable from each other, the endings
  // are reachable from live stages only, and leaving an ending is a confirmed Reopen.
  it('moves freely between live stages, forwards and backwards, approval stages included', () => {
    expect(canManualTransition('production', 'ready')).toBe(true)
    expect(canManualTransition('ready', 'delivered')).toBe(true)
    expect(canManualTransition('delivered', 'completed')).toBe(true)
    // The two examples from the workshop.
    expect(canManualTransition('production', 'customer_changes_requested')).toBe(true) // back to revisions
    expect(canManualTransition('waiting_factory_approval', 'production')).toBe(true)   // CAD review → production
    expect(canManualTransition('new', 'waiting_customer_approval')).toBe(true)          // asked offline
    expect(canManualTransition('customer_approved', 'production')).toBe(true)
    expect(canManualTransition('production', 'completed')).toBe(true) // skipping is a decision, not an error
    for (const from of ORDER_STAGES.filter(isLiveStage)) for (const to of ORDER_STAGES.filter(isLiveStage)) {
      if (from !== to) expect(canManualTransition(from, to), `${from} → ${to}`).toBe(true)
    }
  })
  it('in_process is a live stage between the estimate and the paperwork', () => {
    expect(ORDER_STAGES).toContain('in_process')
    expect(STAGE_LABELS.in_process).toBe('In Process')
    expect(isLiveStage('in_process')).toBe(true)
    expect(orderStatusGroup('in_process')).toBe('active')
    expect(canManualTransition('new', 'in_process')).toBe(true)
    expect(canManualTransition('in_process', 'production')).toBe(true)
    expect(canSendForApproval('in_process', 'customer')).toBe(true)
    expect(canSendToProduction('in_process')).toBe(true)
  })
  it('allows cancel from any live stage, and nothing leaves cancelled', () => {
    expect(canManualTransition('new', 'cancelled')).toBe(true)
    expect(canManualTransition('production', 'cancelled')).toBe(true)
    expect(canManualTransition('completed', 'cancelled')).toBe(false)
    expect(canManualTransition('cancelled', 'cancelled')).toBe(false)
    for (const s of ORDER_STAGES) expect(canManualTransition('cancelled', s), s).toBe(false)
  })
  it('leaving completed or finished is a Reopen to one target, never a free drag', () => {
    expect(canReopen('completed')).toBe(true)
    expect(canReopen('finished')).toBe(true)
    expect(canReopen('closed_no_sale')).toBe(true)
    expect(canReopen('cancelled')).toBe(false)
    expect(canReopen('production')).toBe(false)
    expect(canManualTransition('completed', REOPEN_TARGET.completed!)).toBe(true)
    expect(canManualTransition('finished', REOPEN_TARGET.finished!)).toBe(true)
    for (const s of ORDER_STAGES) {
      if (s !== REOPEN_TARGET.completed) expect(canManualTransition('completed', s), s).toBe(false)
      if (s !== REOPEN_TARGET.finished) expect(canManualTransition('finished', s), s).toBe(false)
    }
  })
  it('groups the sixteen stages into four answers to "is it open?"', () => {
    for (const s of ORDER_STAGES.filter(isLiveStage)) expect(orderStatusGroup(s), s).toBe('active')
    expect(orderStatusGroup('completed')).toBe('closed')
    expect(orderStatusGroup('finished')).toBe('closed')
    expect(orderStatusGroup('closed_no_sale')).toBe('no_sale')
    expect(orderStatusGroup('cancelled')).toBe('cancelled')
    expect(STATUS_GROUP_LABELS.closed).toBe('Closed Order')
    // A closed order is never open, on any surface that uses the predicate.
    expect(isOpenOrder('completed')).toBe(false)
    expect(isOpenOrder('finished')).toBe(false)
    expect(isOpenOrder('in_process')).toBe(true)
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

describe('finishing a job, without claiming it was produced', () => {
  it('is reachable from every stage where the job is still live, including new', () => {
    // The fault: from 'new' the only manual move was Cancel, so recording a finished repair meant
    // cancelling it or marching it through factory approval into production first.
    //
    // Written as "every non-terminal stage" when terminal-or-not was the only distinction there was.
    // 'closed_no_sale' is neither: it is at rest, and the one move out of it is Reopen — offering
    // Finish there would let a stray tap convert a reversible close into a permanent one, on the one
    // stage whose whole promise is that it comes back.
    for (const s of ORDER_STAGES) {
      if (isTerminalStage(s) || isAtRestStage(s)) continue
      expect(canManualTransition(s, 'finished'), s).toBe(true)
    }
    expect(canManualTransition('closed_no_sale', 'finished')).toBe(false)
  })

  it('and nothing drags out of it — the only way back is the confirmed Reopen', () => {
    expect(isTerminalStage('finished')).toBe(true)
    for (const s of ORDER_STAGES) {
      if (s === REOPEN_TARGET.finished) continue
      expect(canManualTransition('finished', s), s).toBe(false)
    }
  })

  it('is NOT completed — the board must not claim production that did not happen', () => {
    expect(STAGE_LABELS.finished).toBe('Finished')
    expect(STAGE_LABELS.completed).toBe('Completed')
    // Both read as a closed order on every summary surface.
    expect(orderStatusGroup('finished')).toBe('closed')
    expect(orderStatusGroup('completed')).toBe('closed')
  })

  it('a finished order takes no approval', () => {
    expect(canSendForApproval('finished', 'factory')).toBe(false)
    expect(canSendForApproval('finished', 'customer')).toBe(false)
  })
})

describe('what a terminal order still accepts', () => {
  it('the full drawer closes on every terminal stage', () => {
    for (const s of ORDER_STAGES) expect(canEditWorkflow(s), s).toBe(!isTerminalStage(s))
  })

  it('but tax and the invoice photo stay open on finished and completed', () => {
    // They are facts about a document that EXISTS, and tax is the fact most likely to be missing at
    // the moment a job ends — thirteen of fifteen orders on the live tenant reached it with none.
    expect(canEditDocumentFacts('finished')).toBe(true)
    expect(canEditDocumentFacts('completed')).toBe(true)
  })

  it('and shut on cancelled, which is a different idea', () => {
    // Not "over" — "it did not happen". There is no document to be right about, and if a cancelled
    // order did produce an invoice, that invoice is the thing to void rather than re-rate.
    expect(canEditDocumentFacts('cancelled')).toBe(false)
  })

  it('the allowed keys are exactly tax, the photo and the stationery — no price among them', () => {
    // letterheadStyle joined them because it is the same kind of fact: which paper a document that
    // already exists is printed on. Re-issuing a finished invoice on the right company's letterhead
    // changes nothing anybody agreed to; re-pricing it does.
    expect([...DOCUMENT_FACT_FIELDS]).toEqual(['taxChoiceId', 'pstExempt', 'pstExemptionNote', 'invoiceImageId', 'letterheadStyle'])
    for (const priced of ['lineItems', 'depositCents', 'currency', 'orderNumber', 'contactId', 'customerName']) {
      expect(DOCUMENT_FACT_FIELDS as readonly string[], priced).not.toContain(priced)
    }
  })

  it('taxChoiceId carries the destination, so there is no province field to keep open', () => {
    // The server resolves province, kind, label and rate from the one id.
    expect(DOCUMENT_FACT_FIELDS as readonly string[]).not.toContain('deliveryProvince')
  })
})

describe('refusedFields — the decision itself, not its wording', () => {
  const TAX_ONLY = ['taxChoiceId', 'pstExempt', 'pstExemptionNote']
  const PRICED = ['taxChoiceId', 'lineItems', 'depositCents']

  it('a live order refuses nothing', () => {
    for (const s of ORDER_STAGES) {
      if (isTerminalStage(s)) continue
      expect(refusedFields(s, PRICED), s).toEqual([])
    }
  })

  it('a cancelled order refuses the whole edit', () => {
    expect(refusedFields('cancelled', TAX_ONLY)).toBeNull()
    expect(refusedFields('cancelled', [])).toBeNull()
  })

  it('finished and completed take tax and the photo, and nothing else', () => {
    for (const s of ['finished', 'completed'] as const) {
      expect(refusedFields(s, TAX_ONLY), s).toEqual([])
      expect(refusedFields(s, ['invoiceImageId']), s).toEqual([])
      // The three that would re-price a sent invoice.
      expect(refusedFields(s, PRICED), s).toEqual(['lineItems', 'depositCents'])
      expect(refusedFields(s, ['orderNumber', 'customerName']), s).toEqual(['orderNumber', 'customerName'])
    }
  })

  it('an empty patch on a finished order is allowed — it changes nothing', () => {
    expect(refusedFields('finished', [])).toEqual([])
  })
})
