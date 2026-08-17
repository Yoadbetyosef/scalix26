import { describe, it, expect } from 'vitest'
import { canManualTransition, canSendForApproval, stageAfterSend, stageAfterResponse, respondableStage, canSendToProduction, isProtectedStage, isTerminalStage, canEditWorkflow, canEditDocumentFacts,
  DOCUMENT_FACT_FIELDS, refusedFields, ORDER_STAGES, STAGE_LABELS } from './stages'
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

describe('finishing a job, without claiming it was produced', () => {
  it('is reachable from every non-terminal stage, including new', () => {
    // The fault: from 'new' the only manual move was Cancel, so recording a finished repair meant
    // cancelling it or marching it through factory approval into production first.
    for (const s of ORDER_STAGES) {
      if (isTerminalStage(s)) continue
      expect(canManualTransition(s, 'finished'), s).toBe(true)
    }
  })

  it('and nothing moves out of it', () => {
    // A finished job that can be dragged back into production is not finished.
    expect(isTerminalStage('finished')).toBe(true)
    for (const s of ORDER_STAGES) expect(canManualTransition('finished', s), s).toBe(false)
  })

  it('is NOT completed — the board must not claim production that did not happen', () => {
    expect(STAGE_LABELS.finished).toBe('Finished')
    expect(STAGE_LABELS.completed).toBe('Completed')
    // The forward chain still ends at completed; closed is not on it.
    expect(canManualTransition('delivered', 'completed')).toBe(true)
    expect(canManualTransition('new', 'completed')).toBe(false)
  })

  it('does not open an approval stage as a side effect', () => {
    for (const s of ORDER_STAGES) {
      if (isProtectedStage(s)) expect(canManualTransition('new', s), s).toBe(false)
    }
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

  it('the allowed keys are exactly tax and the photo — no price among them', () => {
    expect([...DOCUMENT_FACT_FIELDS]).toEqual(['taxChoiceId', 'pstExempt', 'pstExemptionNote', 'invoiceImageId'])
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
