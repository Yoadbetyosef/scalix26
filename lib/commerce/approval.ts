// Configurable PO approval rules (§10). Defaults: < $500 no approval, ≥ $500 manager, ≥ $5,000 admin,
// custom items always require approval (at least manager). Pure + unit-tested; thresholds can later move
// to commerce_settings without changing call sites.
export type ApprovalLevel = 'none' | 'manager' | 'admin'

export const PO_APPROVAL = { managerCents: 50_000, adminCents: 500_000 }

export function determineApprovalLevel(totalCents: number, hasCustomItem: boolean, thresholds = PO_APPROVAL): ApprovalLevel {
  if (totalCents >= thresholds.adminCents) return 'admin'
  if (totalCents >= thresholds.managerCents || hasCustomItem) return 'manager'
  return 'none'
}

// A PO may be emailed to the factory ONLY when no approval is required, or it has been approved (§10, §11).
export function canSendPO(status: string, approvalRequired: ApprovalLevel): boolean {
  if (status !== 'draft' && status !== 'approved') return false // wrong state (already sent / cancelled / …)
  return approvalRequired === 'none' || status === 'approved'
}
