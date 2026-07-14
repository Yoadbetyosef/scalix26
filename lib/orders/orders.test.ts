import { describe, it, expect } from 'vitest'
import { canManualTransition, canSendForApproval, stageAfterSend, stageAfterResponse, respondableStage, canSendToProduction, isProtectedStage, ORDER_STAGES } from './stages'
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

  it('send-for-approval is only valid from the right stages and lands on waiting_*', () => {
    expect(canSendForApproval('new', 'factory')).toBe(true)
    expect(canSendForApproval('factory_changes_requested', 'factory')).toBe(true)
    expect(canSendForApproval('new', 'customer')).toBe(false)              // must get factory approval first
    expect(canSendForApproval('factory_approved', 'customer')).toBe(true)
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

  it('production is never automatic — only from customer_approved via the explicit action', () => {
    expect(canSendToProduction('customer_approved')).toBe(true)
    expect(canSendToProduction('customer_changes_requested')).toBe(false)
    expect(canSendToProduction('factory_approved')).toBe(false)
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
