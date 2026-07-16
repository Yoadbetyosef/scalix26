import { describe, it, expect } from 'vitest'
import { determineApprovalLevel, canSendPO } from './approval'

describe('PO approval rules (§10)', () => {
  it('thresholds: <$500 none, ≥$500 manager, ≥$5000 admin', () => {
    expect(determineApprovalLevel(49_999, false)).toBe('none')
    expect(determineApprovalLevel(50_000, false)).toBe('manager')
    expect(determineApprovalLevel(499_999, false)).toBe('manager')
    expect(determineApprovalLevel(500_000, false)).toBe('admin')
  })
  it('custom items always require approval, even below $500', () => {
    expect(determineApprovalLevel(10_000, true)).toBe('manager')
    expect(determineApprovalLevel(0, true)).toBe('manager')
  })
})

describe('A PO cannot be sent before required approval (§10/§11)', () => {
  it('no-approval PO is sendable from draft; approval-required PO is not sendable until approved', () => {
    expect(canSendPO('draft', 'none')).toBe(true)
    expect(canSendPO('draft', 'manager')).toBe(false) // must be approved first
    expect(canSendPO('draft', 'admin')).toBe(false)
    expect(canSendPO('approved', 'manager')).toBe(true)
    expect(canSendPO('approved', 'admin')).toBe(true)
  })
  it('an already-sent or cancelled PO is not re-sendable', () => {
    expect(canSendPO('sent_to_supplier', 'none')).toBe(false)
    expect(canSendPO('cancelled', 'none')).toBe(false)
  })
})
