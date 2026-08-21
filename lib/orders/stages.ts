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

// ── WHAT A TERMINAL ORDER STILL ACCEPTS, AND WHY CANCELLED IS NOT THE SAME THING ────────────────
//
// The three terminal stages read as one idea — "over" — and they are not. Two of them describe a job
// that HAPPENED and produced a document somebody is holding. The third describes a job that did not.
//
//   completed / finished   the work is done. The invoice exists, or will. Its tax and its photograph
//                          are facts ABOUT THAT DOCUMENT, and they are exactly the facts most likely
//                          to be wrong at the moment the job ends — thirteen of one tenant's fifteen
//                          orders reached this point carrying no tax at all. Locking them here means
//                          the only way to correct an invoice is to un-finish the job, which is a lie
//                          about the workflow told to fix a number.
//
//   cancelled              it is not happening. There is no document to be right about. Editing the
//                          tax on a cancelled order is not a correction, it is noise on a record that
//                          exists to say the work stopped — and if a cancelled order DID produce an
//                          invoice, that invoice is the thing to void, not to re-rate.
//
// So the split is not "terminal vs not". It is "did this produce a document" vs "did it not", and
// those two questions have never had the same answer.
//
// PRICES ARE NOT DOCUMENT FACTS. Line items, deposit, currency and the order number stay shut on
// every terminal stage: updateOrder recomputes subtotal_cents and balance_cents whenever lineItems is
// present, so a save that changed nothing but the tax would silently re-price an invoice a customer
// already holds. That is the whole reason this is a separate, narrower editor rather than the drawer
// unlocked.

/** The full edit drawer — customer, factory, line items, dates, notes. Workflow, and it closes. */
export const canEditWorkflow = (s: OrderStage): boolean => !isTerminalStage(s)

/**
 * Tax (rate, destination and the exemption) and the invoice photograph. Open on every stage except
 * cancelled — see above for why that one differs.
 */
export const canEditDocumentFacts = (s: OrderStage): boolean => s !== 'cancelled'

/**
 * The only keys a terminal order accepts. Enforced in PATCH /api/orders/[id], not just hidden in the
 * page — the route had NO stage check at all, so the old gate was a hidden button rather than a rule
 * and every future caller inherited the hole.
 *
 * `taxChoiceId` carries the destination province with it: the server resolves province, kind, label
 * and rate from the one id, so there is no separate delivery-province field to keep open.
 */
export const DOCUMENT_FACT_FIELDS = ['taxChoiceId', 'pstExempt', 'pstExemptionNote', 'invoiceImageId', 'letterheadStyle'] as const

/**
 * Which of the offered keys this stage refuses. Pure, so the decision is testable rather than
 * asserted as a string in a route file — the first version of this WAS a string assertion, and
 * deleting the branch it guarded left every test green.
 *
 * Returns null when the whole edit is refused (cancelled), an array of refused keys when only some
 * are (finished / completed), and an empty array when everything is allowed.
 */
export function refusedFields(stage: OrderStage, offered: string[]): string[] | null {
  if (canEditWorkflow(stage)) return []
  if (!canEditDocumentFacts(stage)) return null
  return offered.filter((k) => !(DOCUMENT_FACT_FIELDS as readonly string[]).includes(k))
}

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
