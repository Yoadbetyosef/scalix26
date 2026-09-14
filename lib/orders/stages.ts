// Order stage state machine. Approval-related transitions happen ONLY through explicit workflow actions
// (send-for-approval, record-response, send-to-production) — never via free drag. Non-approval forward moves
// (production → ready → delivered → completed) and cancellation are manual. Pure + tested.

export const ORDER_STAGES = [
  'new', 'pending', 'in_process', 'waiting_factory_approval', 'factory_changes_requested', 'factory_approved',
  'waiting_customer_approval', 'customer_changes_requested', 'customer_approved',
  'production', 'ready', 'delivered', 'completed', 'finished', 'closed_no_sale', 'cancelled',
] as const
export type OrderStage = typeof ORDER_STAGES[number]

export const STAGE_LABELS: Record<OrderStage, string> = {
  new: 'New Order', pending: 'Pending', in_process: 'In Process', waiting_factory_approval: 'Waiting for Factory Approval', factory_changes_requested: 'Factory Changes Requested',
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

// ── PENDING: PARKED, AND STILL HERS ─────────────────────────────────────────────────────────────
//
// Not terminal, not at rest, and deliberately not either. 'closed_no_sale' says the customer did not
// buy; 'pending' says nobody has stopped, the job is simply waiting on something — a stone to arrive,
// a size to be confirmed, a customer on holiday. Before this the only places to put such a job were
// 'new' (which is a lie about it being untouched) and 'closed_no_sale' (which is a lie about losing
// it), and both of those are what the board actually contained.
//
// It is WORK, so it keeps a column, it keeps its colour on the working side of the fan, and it is
// reachable from anywhere a live job can be. What it is not is a step: coming back from pending
// returns the job to 'new', the same one honest move 'closed_no_sale' makes, because a parked job
// resumes rather than advances.
export const isPendingStage = (s: OrderStage): boolean => s === 'pending'

// ── IN PROCESS: THE CUSTOMER SAID YES, AND THE PAPERWORK HAS NOT CAUGHT UP ──────────────────────
//
// A verbal go-ahead — on the phone, across the counter — before the deposit is taken and before any
// formal approval link has been answered. TG works this way for most retail pieces: the customer
// agrees, the jeweller starts sourcing the stone, and the signed approval and the deposit follow
// over the next days. Until now that job had to sit in 'new' (a lie about being untouched) or be
// pushed into an approval stage nobody had actually sent.
//
// It is a live, working stage: it keeps a column, it can be sent for approval, it can be invoiced,
// a deposit can be recorded against it, and it can go straight to production.
export const isInProcessStage = (s: OrderStage): boolean => s === 'in_process'

// ── STATUS GROUPS: WHAT A LIST, A FILTER AND A CUSTOMER'S HISTORY CALL AN ORDER ─────────────────
//
// Sixteen stages are right for a board and wrong for a summary. Every surface that answers "is this
// still open?" reads THIS, never a hand-written list of stages — the list view, the customer's
// history, the search results and the reports all agree by construction.
//
//   active         being worked, in any of the live stages
//   closed         over, and the work happened — 'completed' and 'finished' both. A closed order is
//                  never shown as open anywhere, which was the fault: a finished job kept reading as
//                  live in places that listed stages by hand.
//   no_sale        quoted and not taken — at rest, reopenable
//   cancelled      it is not happening
export type OrderStatusGroup = 'active' | 'closed' | 'no_sale' | 'cancelled'
export const STATUS_GROUP_LABELS: Record<OrderStatusGroup, string> = {
  active: 'Active', closed: 'Closed Order', no_sale: 'Closed – No Sale', cancelled: 'Cancelled',
}
export function orderStatusGroup(s: OrderStage): OrderStatusGroup {
  if (s === 'cancelled') return 'cancelled'
  if (s === 'closed_no_sale') return 'no_sale'
  if (s === 'completed' || s === 'finished') return 'closed'
  return 'active'
}
/** True when the order should appear in "open" lists. One predicate, used everywhere. */
export const isOpenOrder = (s: OrderStage): boolean => orderStatusGroup(s) === 'active'

/**
 * No column on the board. NOT the same as terminal: 'completed' is terminal and keeps its column,
 * because it is the end of the forward chain and the drag target out of 'delivered'. These three are
 * places work LEAVES the board for, so a column of them would grow forever and never be worked from.
 */
export const hasNoBoardColumn = (s: OrderStage): boolean =>
  s === 'cancelled' || s === 'finished'

/**
 * What a column is CALLED on the board, when that differs from the stage's own label.
 *
 * 'closed_no_sale' is "Closed – No Sale" everywhere a stage is named — on the button, in the
 * timeline, in the table — and that is the right words for an action and for a record. As a standing
 * column heading it is a negative sentence at the top of the widest column on the board, so the
 * column says what the pile IS: lost business.
 *
 * A separate map rather than a renamed label, because the two are genuinely different jobs and the
 * label is asserted by name in lib/orders/closed-no-sale.test.ts.
 */
export const BOARD_COLUMN_LABELS: Partial<Record<OrderStage, string>> = {
  closed_no_sale: 'Lost business',
}
export const boardColumnLabel = (s: OrderStage): string => BOARD_COLUMN_LABELS[s] ?? STAGE_LABELS[s]

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

// ── MANUAL MOVES: ANYWHERE A LIVE JOB CAN HONESTLY GO ───────────────────────────────────────────
//
// This used to be a forward chain — production → ready → delivered → completed — with every other
// move refused, and the approval stages sealed off entirely because "entering one is action-only".
// In the workshop that rule was wrong in both directions. A piece in production comes BACK to
// revisions when the customer changes the stone; a repeat trade order goes from the estimate
// straight to production with nothing to approve; a job parked as pending resumes wherever it was.
// The board could do none of that, so the stage stopped describing the job and started describing
// what the software allowed.
//
// So the rule is now about what a stage MEANS, not about adjacency:
//
//   · between any two LIVE stages, in either direction: allowed. Approval stages included — moving
//     a job into "Waiting for customer approval" by hand says the customer is being asked offline,
//     and the approval request table still records what was actually sent.
//   · into the three ways a job ENDS (finished, cancelled, no sale): from a live stage only, and
//     no-sale not from a piece already being made — abandoning real work is a cancellation.
//   · OUT of an ending: closed_no_sale reopens to 'new'; completed and finished reopen through
//     REOPEN_TARGET (an explicit, confirmed action on the order page, never a stray drag);
//     cancelled is final.
//
// Every move, from every surface, still goes through setStageManual, which writes the timeline row
// carrying from, to, who and why. The freedom is in WHERE a job may go, not in whether it is recorded.
/** The piece is being made. Walking away from one of these is a cancellation, not a lost quote. */
const IN_FLIGHT = new Set<OrderStage>(['production', 'ready', 'delivered'])
/** Live: neither ended nor at rest. Where the ordinary work of the board happens. */
export const isLiveStage = (s: OrderStage): boolean => !isTerminalStage(s) && !isAtRestStage(s)

/**
 * Where a closed order goes when it is reopened. Completed work reopens at 'delivered' — the piece
 * exists and was handed over, so the honest live stage is the last one it passed through. A
 * 'finished' job said nothing about production and reopens at 'new'.
 */
export const REOPEN_TARGET: Partial<Record<OrderStage, OrderStage>> = {
  completed: 'delivered', finished: 'new', closed_no_sale: 'new',
}
export const canReopen = (s: OrderStage): boolean => REOPEN_TARGET[s] !== undefined

export function canManualTransition(from: OrderStage, to: OrderStage): boolean {
  if (from === to) return false
  // NOTHING LEAVES CANCELLED. It is the one stage that is final on purpose, and the page says so
  // before it is chosen.
  if (from === 'cancelled') return false
  // THE ENDINGS. Reachable from any live stage. Not from an ending or from a no-sale: getting out of
  // those is Reopen, then whatever you meant — two honest steps, so one stray tap cannot turn a
  // reversible close into a permanent one.
  if (to === 'cancelled' || to === 'finished' || to === 'completed') return isLiveStage(from)
  // Closing as no-sale is a thing you do to a LIVE estimate — not to a piece already being made.
  if (to === 'closed_no_sale') return isLiveStage(from) && !IN_FLIGHT.has(from)
  // Out of an ending or a no-sale: only the reopen target, and only through this one door.
  if (isTerminalStage(from) || isAtRestStage(from)) return REOPEN_TARGET[from] === to
  // Between live stages: free, both directions.
  return isLiveStage(to)
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
// order skips customer approval entirely (repeat/trade orders, or the customer already agreed offline),
// OR from 'in_process' — the verbal yes IS the customer's approval for most retail work, and the
// signed paperwork follows the deposit rather than preceding it.
export const canSendToProduction = (stage: OrderStage): boolean =>
  stage === 'customer_approved' || stage === 'factory_approved' || stage === 'in_process'
