// Business Opportunity Engine — Lead Recovery detector (Sprint 4.4B)
//
// Pure & deterministic: reads only the DecisionContext, reuses shared detector-helpers
// (incl. the OPEN_LEAD_STATUSES taxonomy — no duplicated logic), performs zero I/O /
// zero writes / zero scoring, never creates an Opportunity, and knows about no other
// detector. `detect` returns DetectionResult | null.

import type { Detector, DetectionResult } from '../detector'
import type { DecisionContext } from '../context-types'
import type { Evidence } from '../types'
import { latestLead, daysSince, OPEN_LEAD_STATUSES } from '../detector-helpers'

// Configured minimum age before a lead is considered "abandoned". Declared constant.
const LEAD_AGE_DAYS = 3

export const leadRecoveryDetector: Detector = {
  id: 'lead_recovery.aging_open_lead',
  name: 'Lead Recovery — aging open lead',
  description:
    'Detects a lead recovery opportunity when the latest lead is open, has no response, and is at least 3 days old.',
  version: 1,

  goal: 'Recover abandoned leads',
  tags: ['sales', 'leads'],

  opportunityType: 'LEAD_RECOVERY',
  playbook: 'lead_recovery',

  priorityBand: 'owed_response',
  basePriority: 50,

  emittedStatus: 'DETECTED',
  status: 'active',
  owner: 'opportunity-engine',
  supportedBusinessTypes: 'all',

  estimates: {
    impact: { kind: 'revenue', magnitude: 'high', basis: 'declared:v1' },
    cost: { channel: 'sms', units: 1, money: 0, basis: 'declared:v1' },
  },

  expirationRuleRef: 'lead_recovery.expire_v1',
  reactivationRuleRef: 'lead_recovery.reactivate_v1',

  detect(context: DecisionContext): DetectionResult | null {
    const lead = latestLead(context)
    if (!lead) return null
    if (lead.status === null || !OPEN_LEAD_STATUSES.includes(lead.status)) return null
    if (lead.respondedAt !== null) return null

    const now = context.metadata.assembledAt
    const ageDays = daysSince(lead.createdAt, now)
    if (ageDays === null || ageDays < LEAD_AGE_DAYS) return null

    const evidence: Evidence[] = [
      { field: 'lead.status', value: lead.status, source: 'leads', observedAt: now },
      { field: 'lead.responded_at', value: lead.respondedAt, source: 'leads', observedAt: now },
      { field: 'lead.age_days', value: ageDays, source: 'leads', observedAt: now },
      { field: 'lead.is_open', value: true, source: 'leads', observedAt: now },
    ]

    return {
      anchorRef: { kind: 'lead', id: lead.id },
      evidence,
      confidence: 'high',
    }
  },
}
