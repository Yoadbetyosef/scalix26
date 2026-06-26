// Business Opportunity Engine — Review Request detector (Sprint 4.4A)
//
// The golden-path first detector: validates the whole detector architecture end-to-end
// (Detector interface + registry + DecisionContext + helpers + DetectionResult).
//
// Pure & deterministic: reads only the DecisionContext, uses shared detector-helpers,
// performs zero I/O / zero writes / zero scoring, never creates an Opportunity, and
// knows about no other detector. `detect` returns DetectionResult | null.

import type { Detector, DetectionResult } from '../detector'
import type { DecisionContext } from '../context-types'
import type { Evidence } from '../types'
import { hasCompletedAppointmentWithinDays, isWithinDays } from '../detector-helpers'

// Configured detection window: a completed appointment is review-eligible for this many
// days after completion. Declared constant — deterministic, not a runtime flag.
const REVIEW_WINDOW_DAYS = 30

export const reviewRequestDetector: Detector = {
  id: 'review_request.after_completion',
  name: 'Review Request — after completed appointment',
  description:
    'Detects a review opportunity when a completed appointment has had no review sent and is not skipped, within the configured window.',
  version: 1,

  goal: 'Increase review collection',
  tags: ['reviews', 'reputation'],

  opportunityType: 'REVIEW_REQUEST',
  playbook: 'review_growth',

  priorityBand: 'reputation',
  basePriority: 40,

  emittedStatus: 'DETECTED',
  status: 'active',
  owner: 'opportunity-engine',
  supportedBusinessTypes: 'all',

  estimates: {
    impact: { kind: 'reputation', magnitude: 'medium', basis: 'declared:v1' },
    cost: { channel: 'sms', units: 1, money: 0, basis: 'declared:v1' },
  },

  expirationRuleRef: 'review_request.expire_v1',
  reactivationRuleRef: 'review_request.reactivate_v1',

  detect(context: DecisionContext): DetectionResult | null {
    // Gate (shared helper): is there any completed appointment within the window?
    if (!hasCompletedAppointmentWithinDays(context, REVIEW_WINDOW_DAYS)) return null

    const now = context.metadata.assembledAt

    // The most recent completed appointment that is review-eligible:
    // no review sent, not skipped, and within the window (slotDate proxy → createdAt).
    const appointment = context.appointments.find(
      (a) =>
        a.status === 'completed' &&
        a.reviewSentAt === null &&
        a.skipReview !== true &&
        isWithinDays(a.slotDate ?? a.createdAt, REVIEW_WINDOW_DAYS, now),
    )
    if (!appointment) return null

    const evidence: Evidence[] = [
      { field: 'appointment.status', value: appointment.status, source: 'appointments', observedAt: now },
      { field: 'appointment.review_sent_at', value: appointment.reviewSentAt, source: 'appointments', observedAt: now },
      { field: 'appointment.skip_review', value: appointment.skipReview, source: 'appointments', observedAt: now },
      { field: 'appointment.slot_date', value: appointment.slotDate, source: 'appointments', observedAt: now },
    ]

    return {
      anchorRef: { kind: 'appointment', id: appointment.id },
      evidence,
      confidence: 'high',
    }
  },
}
