// Order stage state machine. Approval-related transitions happen ONLY through explicit workflow actions
// (send-for-approval, record-response, send-to-production) — never via free drag. Non-approval forward moves
// (production → ready → delivered → completed) and cancellation are manual. Pure + tested.

export const ORDER_STAGES = [
  'new', 'waiting_factory_approval', 'factory_changes_requested', 'factory_approved',
  'waiting_customer_approval', 'customer_changes_requested', 'customer_approved',
  'production', 'ready', 'delivered', 'completed', 'cancelled',
] as const
export type OrderStage = typeof ORDER_STAGES[number]

export const STAGE_LABELS: Record<OrderStage, string> = {
  new: 'New Order', waiting_factory_approval: 'Waiting for Factory Approval', factory_changes_requested: 'Factory Changes Requested',
  factory_approved: 'Factory Approved', waiting_customer_approval: 'Waiting for Customer Approval', customer_changes_requested: 'Customer Changes Requested',
  customer_approved: 'Customer Approved', production: 'Production', ready: 'Ready', delivered: 'Delivered', completed: 'Completed', cancelled: 'Cancelled',
}

// Stages whose entry/exit is governed by the approval workflow — never draggable.
export const PROTECTED_STAGES = new Set<OrderStage>([
  'waiting_factory_approval', 'factory_changes_requested', 'factory_approved',
  'waiting_customer_approval', 'customer_changes_requested', 'customer_approved',
])
export const isProtectedStage = (s: OrderStage): boolean => PROTECTED_STAGES.has(s)
export const isTerminalStage = (s: OrderStage): boolean => s === 'completed' || s === 'cancelled'

export type ApprovalType = 'factory' | 'customer'
export type ApprovalDecision = 'approved' | 'changes_requested' | 'rejected'

// Manual (drag / explicit set-stage) transitions allowed. Excludes ALL approval transitions. Cancel is
// allowed from any non-terminal stage.
const MANUAL_FORWARD: Partial<Record<OrderStage, OrderStage[]>> = {
  production: ['ready'], ready: ['delivered'], delivered: ['completed'],
}
export function canManualTransition(from: OrderStage, to: OrderStage): boolean {
  if (from === to) return false
  if (to === 'cancelled') return !isTerminalStage(from)
  if (isProtectedStage(to)) return false // entering an approval stage is action-only
  return (MANUAL_FORWARD[from] ?? []).includes(to)
}

// Which stages permit sending a given approval type (a "Send to Factory/Customer" action).
export function canSendForApproval(stage: OrderStage, type: ApprovalType): boolean {
  if (type === 'factory') return stage === 'new' || stage === 'factory_changes_requested'
  return stage === 'factory_approved' || stage === 'customer_changes_requested' || stage === 'customer_approved'
}
export const stageAfterSend = (type: ApprovalType): OrderStage => (type === 'factory' ? 'waiting_factory_approval' : 'waiting_customer_approval')

// Resulting stage after a recipient responds. Reject maps to the same "changes requested" holding stage
// (it needs Tatiana's attention / a revision), consistent with the workflow.
export function stageAfterResponse(type: ApprovalType, decision: ApprovalDecision): OrderStage {
  if (type === 'factory') return decision === 'approved' ? 'factory_approved' : 'factory_changes_requested'
  return decision === 'approved' ? 'customer_approved' : 'customer_changes_requested'
}
// The stage an approval response is only valid FROM (guards against stale/duplicate responses).
export const respondableStage = (type: ApprovalType): OrderStage => (type === 'factory' ? 'waiting_factory_approval' : 'waiting_customer_approval')

export const canSendToProduction = (stage: OrderStage): boolean => stage === 'customer_approved'
