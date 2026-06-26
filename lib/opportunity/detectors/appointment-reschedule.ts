// Business Opportunity Engine — Appointment Reschedule detector (Sprint 4.4B)
//
// Pure & deterministic: reads only the DecisionContext, reuses shared detector-helpers,
// performs zero I/O / zero writes / zero scoring, never creates an Opportunity, and
// knows about no other detector. `detect` returns DetectionResult | null.

import type { Detector, DetectionResult } from '../detector'
import type { DecisionContext } from '../context-types'
import type { Evidence } from '../types'
import { latestAppointment, hasUpcomingAppointment } from '../detector-helpers'

export const appointmentRescheduleDetector: Detector = {
  id: 'appointment_reschedule.after_cancellation',
  name: 'Appointment Reschedule — after cancellation',
  description:
    'Detects a reschedule opportunity when the latest appointment was cancelled and no upcoming confirmed appointment already exists.',
  version: 1,

  goal: 'Recover cancelled appointments',
  tags: ['scheduling', 'revenue'],

  opportunityType: 'APPOINTMENT_RESCHEDULE',
  playbook: 'scheduling',

  priorityBand: 'owed_response',
  basePriority: 55,

  emittedStatus: 'DETECTED',
  status: 'active',
  owner: 'opportunity-engine',
  supportedBusinessTypes: 'all',

  estimates: {
    impact: { kind: 'revenue', magnitude: 'high', basis: 'declared:v1' },
    cost: { channel: 'sms', units: 1, money: 0, basis: 'declared:v1' },
  },

  expirationRuleRef: 'appointment_reschedule.expire_v1',
  reactivationRuleRef: 'appointment_reschedule.reactivate_v1',

  detect(context: DecisionContext): DetectionResult | null {
    const latest = latestAppointment(context)
    if (!latest) return null
    if (latest.status !== 'cancelled') return null

    // A replacement already on the calendar means there's nothing to recover.
    if (hasUpcomingAppointment(context)) return null

    const now = context.metadata.assembledAt
    const evidence: Evidence[] = [
      { field: 'appointment.status', value: latest.status, source: 'appointments', observedAt: now },
      { field: 'appointment.has_upcoming_replacement', value: false, source: 'appointments', observedAt: now },
      { field: 'appointment.slot_date', value: latest.slotDate, source: 'appointments', observedAt: now },
      { field: 'appointment.service_type', value: latest.serviceType, source: 'appointments', observedAt: now },
    ]

    return {
      anchorRef: { kind: 'appointment', id: latest.id },
      evidence,
      confidence: 'high',
    }
  },
}
