// Order stage state machine. Approval-related transitions happen ONLY through explicit workflow actions
// (send-for-approval, record-response, send-to-production) — never via free drag. Non-approval forward moves
// (production → ready → delivered → completed) and cancellation are manual. Pure + tested.

export const ORDER_STAGES = [
  'new', 'waiting_factory_approval', 'factory_changes_requested', 'factory_approved',
  'waiting_customer_approval', 'customer_changes_requested', 'customer_approved',
  'production', 'ready', 'delivered', 'completed', 'finished', 'closed_no_sale', 'cancelled',
] as const
export type OrderStage = typeof ORDER_STAGES[number]

export const STAGE_LABELS: Record<OrderStage, string> = {
  new: 'New Order', waiting_factory_approval: 'Waiting for Factory Approval', factory_changes_requested: 'Factory Changes Requested',
  factory_approved: 'Factory Approved', waiting_customer_approval: 'Waiting for Customer Approval', customer_changes_requested: 'Customer Changes Requested',
  customer_approved: 'Customer Approved', production: 'Production', ready: 'Ready', delivered: 'Delivered', completed: 'Completed', finished: 'Finished',
  closed_no_sale: 'Closed – No Sale', cancelled: 'Cancelled',
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
//
// 'closed_no_sale' is NOT one of them, and that is the whole reason it exists. See below.
export const isTerminalStage = (s: OrderStage): boolean => s === 'completed' || s === 'finished' || s === 'cancelled'

// ── CLOSED, NO SALE: AT REST, NOT OVER ──────────────────────────────────────────────────────────
//
// An estimate the customer did not take. TG writes ~30 a day and a handful convert; the rest are
// neither cancelled work nor finished work, and every one has to stay in that customer's history
// because the customer comes back.
//
// The three stages above are one-way because the thing they describe HAPPENED. This one describes an
// absence, and an absence can end. So it is deliberately not terminal:
//
//   · it is not work in progress — the board and the default list leave it out, like the terminal three
//   · it is not an error — nothing was lost and nothing went wrong, which is why it is muted rather
//     than red, and why the confirmation does not warn
//   · it REOPENS — the only move out is back to 'new', restoring the estimate exactly as it was.
//     Reopening does not advance it, because coming back is not progress, it is a second chance.
//
// Being non-terminal also means canEditWorkflow stays true here, which is right: a customer who
// returns usually returns wanting a change, and an estimate you cannot edit is one you have to retype.
export const isAtRestStage = (s: OrderStage): boolean => s === 'closed_no_sale'

/**
 * No column on the board. NOT the same as terminal: 'completed' is terminal and keeps its column,
 * because it is the end of the forward chain and the drag target out of 'delivered'. These three are
 * places work LEAVES the board for, so a column of them would grow forever and never be worked from.
 */
export const hasNoBoardColumn = (s: OrderStage): boolean =>
  s === 'cancelled' || s === 'finished' || s === 'closed_no_sale'

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
  // THE ONE MOVE BACK IN THE WHOLE MACHINE. Reopening restores the estimate to where it was and no
  // further: a customer returning is not the job advancing.
  closed_no_sale: ['new'],
}
/** The piece is being made. Walking away from one of these is a cancellation, not a lost quote. */
const IN_FLIGHT = new Set<OrderStage>(['production', 'ready', 'delivered'])

export function canManualTransition(from: OrderStage, to: OrderStage): boolean {
  if (from === to) return false
  // FINISH AND CANCEL ARE REACHABLE FROM ANYWHERE, and that is what the forward chain above cannot do.
  // A job at 'new' had exactly one move available — Cancel — so the only way to record a finished
  // repair was to cancel it or to march it through factory approval into production first. Both of
  // those put something false on the board.
  // AT REST IS EXCLUDED HERE TOO, and the first version of this forgot it. 'closed_no_sale' is not
  // terminal, so cancel and finish were both offered out of it — which meant one stray tap turned a
  // reversible close into a permanent one, on the stage whose whole promise is that it comes back.
  // Getting out of a no-sale is Reopen, and then whatever you meant. Two honest steps.
  if (to === 'cancelled' || to === 'finished') return !isTerminalStage(from) && !isAtRestStage(from)
  // Closing as no-sale is a thing you do to a LIVE estimate, so it is offered wherever cancel is —
  // except out of a stage where the piece is already being made. An order in production that the
  // customer walks away from is a cancellation, with a factory to tell; calling that a no-sale would
  // file real, abandoned work under "they never bought".
  if (to === 'closed_no_sale') return !isTerminalStage(from) && !isAtRestStage(from) && !IN_FLIGHT.has(from)
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
