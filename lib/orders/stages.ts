// Order stage state machine. Approval-related transitions happen ONLY through explicit workflow actions
// (send-for-approval, record-response, send-to-production) — never via free drag. Non-approval forward moves
// (production → ready → delivered → completed) and cancellation are manual. Pure + tested.

export const ORDER_STAGES = [
  'new', 'waiting_factory_approval', 'factory_changes_requested', 'factory_approved',
  'waiting_customer_approval', 'customer_changes_requested', 'customer_approved',
  'production', 'ready', 'delivered', 'completed', 'finished', 'cancelled',
] as const
export type OrderStage = typeof ORDER_STAGES[number]

export const STAGE_LABELS: Record<OrderStage, string> = {
  new: 'New Order', waiting_factory_approval: 'Waiting for Factory Approval', factory_changes_requested: 'Factory Changes Requested',
  factory_approved: 'Factory Approved', waiting_customer_approval: 'Waiting for Customer Approval', customer_changes_requested: 'Customer Changes Requested',
  customer_approved: 'Customer Approved', production: 'Production', ready: 'Ready', delivered: 'Delivered', completed: 'Completed', finished: 'Finished', cancelled: 'Cancelled',
}

// Stages whose entry/exit is governed by the approval workflow — never draggable.
export const PROTECTED_STAGES = new Set<OrderStage>([
  'waiting_factory_approval', 'factory_changes_requested', 'factory_approved',
  'waiting_customer_approval', 'customer_changes_requested', 'customer_approved',
])
export const isProtectedStage = (s: OrderStage): boolean => PROTECTED_STAGES.has(s)
// THREE terminal stages, and the difference between two of them is the point.
//
//   completed — produced and finished.
//   finished  — over, and saying NOTHING about how. A repair, a stock sale, a piece the customer
//               collected; work that never went near a factory. Marking those 'completed' would have
//               the board claim production that did not happen.
//   cancelled — it is not happening.
export const isTerminalStage = (s: OrderStage): boolean => s === 'completed' || s === 'finished' || s === 'cancelled'

export type ApprovalType = 'factory' | 'customer'
export type ApprovalDecision = 'approved' | 'changes_requested' | 'rejected'

// Manual (drag / explicit set-stage) transitions allowed. Excludes ALL approval transitions. Cancel and
// finish are both allowed from any non-terminal stage.
const MANUAL_FORWARD: Partial<Record<OrderStage, OrderStage[]>> = {
  production: ['ready'], ready: ['delivered'], delivered: ['completed'],
}
export function canManualTransition(from: OrderStage, to: OrderStage): boolean {
  if (from === to) return false
  // FINISH AND CANCEL ARE REACHABLE FROM ANYWHERE, and that is what the forward chain above cannot do.
  // A job at 'new' had exactly one move available — Cancel — so the only way to record a finished
  // repair was to cancel it or to march it through factory approval into production first. Both of
  // those put something false on the board.
  if (to === 'cancelled' || to === 'finished') return !isTerminalStage(from)
  if (isProtectedStage(to)) return false // entering an approval stage is action-only
  return (MANUAL_FORWARD[from] ?? []).includes(to)
}

// Which stages permit sending a given approval type (a "Send to Factory/Customer" action).
//
// ── THE TWO APPROVALS ARE INDEPENDENT ───────────────────────────────────────────────────────────────
//
// This used to encode a sequence: factory first, then customer. That is one way a piece is made, not
// the way. Sometimes the customer sees the estimate and agrees before anything reaches a workshop;
// sometimes the factory is engaged first. Neither is a prerequisite for the other, and a gate that
// assumed otherwise made the "Send to Customer" button invisible on a new order — exactly when it is
// wanted.
//
// Both may now be outstanding at once. `stage` is a single field and can only describe one of them,
// so the board column shows whichever was sent last: a KNOWN and accepted ambiguity. The truth about
// each approval lives in order_approval_requests, which has a row per type with its own status; the
// stage is a summary, and a summary of two things in one field is necessarily lossy.
//
// Terminal stages are excluded outright — an approval on a cancelled or completed order is never
// wanted, and the old gate got that for free by listing stages rather than excluding them.
export function canSendForApproval(stage: OrderStage, type: ApprovalType): boolean {
  if (isTerminalStage(stage)) return false
  const inFlight: OrderStage[] = ['production', 'ready', 'delivered']
  if (inFlight.includes(stage)) return false
  if (type === 'factory') {
    // Not while the factory's own request is already out — that would be a duplicate, not a parallel.
    return stage !== 'waiting_factory_approval'
  }
  return stage !== 'waiting_customer_approval'
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

// Production can start once the CUSTOMER has approved, OR straight after the FACTORY approves when the
// order skips customer approval entirely (repeat/trade orders, or the customer already agreed offline).
export const canSendToProduction = (stage: OrderStage): boolean => stage === 'customer_approved' || stage === 'factory_approved'
