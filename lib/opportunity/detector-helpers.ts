// Business Opportunity Engine — Detector Helpers (Sprint 4.3.5)
//
// Pure, read-only factual primitives shared by every detector. These answer ONE kind
// of question — "what facts are true in this DecisionContext?" — and NEVER "should we
// create an opportunity?". No business decisions, no scoring, no opportunity creation.
//
// Determinism is structural: every temporal helper takes an explicit reference instant
// (callers pass context.metadata.assembledAt); there is no Date.now()/new Date()-of-now,
// no randomness, no I/O. Helpers never mutate the context or its arrays.

import type {
  DecisionContext,
  ContextAppointment,
  ContextLead,
  ContextConversation,
} from './context-types'

/** Non-terminal lead statuses — an "open" lead. Excludes terminal 'booked'/'dismissed'. */
export const OPEN_LEAD_STATUSES: readonly string[] = ['new', 'contacted', 'called_back']

const MS_PER_DAY = 86_400_000

// ─── Pure date utilities (explicit reference instant — never the clock) ──────

/** Whole days between `date` and `referenceIso`. Null when either is missing/unparseable. */
export function daysSince(date: string | null, referenceIso: string): number | null {
  if (!date) return null
  const t = Date.parse(date)
  const ref = Date.parse(referenceIso)
  if (isNaN(t) || isNaN(ref)) return null
  return Math.floor((ref - t) / MS_PER_DAY)
}

/** True iff `date` is within the last `n` days of `referenceIso` (0 <= age <= n). */
export function isWithinDays(date: string | null, n: number, referenceIso: string): boolean {
  const age = daysSince(date, referenceIso)
  if (age === null) return false
  return age >= 0 && age <= n
}

// Date-only (YYYY-MM-DD) of an ISO/date string, for calendar-day comparisons that must
// not depend on time-of-day or timezone parsing. Returns null when unparseable.
function dateOnly(value: string | null): string | null {
  if (!value) return null
  // Already a plain date (e.g. a DATE column) — take the leading 10 chars if valid.
  const head = value.slice(0, 10)
  if (/^\d{4}-\d{2}-\d{2}$/.test(head)) return head
  const t = Date.parse(value)
  if (isNaN(t)) return null
  return new Date(t).toISOString().slice(0, 10)
}

// ─── Accessors (latest = most recently created; context is already createdAt-desc) ─

export function latestAppointment(context: DecisionContext): ContextAppointment | null {
  return context.appointments[0] ?? null
}

export function latestCompletedAppointment(context: DecisionContext): ContextAppointment | null {
  return context.appointments.find((a) => a.status === 'completed') ?? null
}

export function latestConversation(context: DecisionContext): ContextConversation | null {
  return context.conversations[0] ?? null
}

export function latestLead(context: DecisionContext): ContextLead | null {
  return context.leads[0] ?? null
}

// ─── Boolean predicates (facts only) ─────────────────────────────────────────

/** Confirmed appointment whose slotDate is today or later (relative to assembledAt). */
export function hasUpcomingAppointment(context: DecisionContext): boolean {
  const today = dateOnly(context.metadata.assembledAt)
  if (!today) return false
  return context.appointments.some((a) => {
    if (a.status !== 'confirmed') return false
    const slot = dateOnly(a.slotDate)
    return slot !== null && slot >= today
  })
}

export function hasCompletedAppointment(context: DecisionContext): boolean {
  return context.appointments.some((a) => a.status === 'completed')
}

export function hasOpenLead(context: DecisionContext): boolean {
  return context.leads.some((l) => l.status !== null && OPEN_LEAD_STATUSES.includes(l.status))
}

/**
 * True iff there is a completed appointment whose completion is within `n` days of
 * assembledAt. Completion proxy = slotDate, falling back to createdAt when slotDate is null.
 */
export function hasCompletedAppointmentWithinDays(context: DecisionContext, n: number): boolean {
  const ref = context.metadata.assembledAt
  return context.appointments.some((a) => {
    if (a.status !== 'completed') return false
    const completedAt = a.slotDate ?? a.createdAt
    return isWithinDays(completedAt, n, ref)
  })
}
