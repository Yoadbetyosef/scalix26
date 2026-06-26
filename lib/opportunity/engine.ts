// Business Opportunity Engine — Decision Core (Sprint 4.5)
//
// A PURE, DETERMINISTIC function: decide(context, registry) -> Decision. It combines
// each enabled detector's metadata + DetectionResult into an Opportunity, scores it
// with deterministic integer math, separates eligible vs suppressed (preserving
// suppressed), selects the single primary, and records a full per-detector trace.
//
// No I/O, no DB, no clock (time comes only from context.metadata.assembledAt), no
// randomness, no writes, no execution. Same context + same registry => identical
// Decision. Detector throws are caught and converted into trace entries, never thrown.

import type {
  Decision,
  DecisionTrace,
  DecisionTraceEntry,
  Opportunity,
  PriorityBand,
  ConfidenceLevel,
  BlockerRef,
} from './types'
import type { DecisionContext } from './context-types'
import type { Detector, DetectionResult } from './detector'
import type { DetectorRegistry } from './registry'

export const ENGINE_VERSION = 1
export const SCORING_VERSION = 1
export const OPPORTUNITY_SCHEMA_VERSION = 1

// Explicit band weights, highest business value first. Drives the *1000 multiplier.
export const BAND_WEIGHTS: Record<PriorityBand, number> = {
  collections: 6,
  owed_response: 5,
  reputation: 4,
  retention: 3,
  sales: 2,
  nurture: 1,
}

const CONFIDENCE_RANK: Record<ConfidenceLevel, number> = { high: 3, medium: 2, low: 1 }

// ─── Pure helpers ────────────────────────────────────────────────────────────

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  const n = Math.trunc(value)
  return n < min ? min : n > max ? max : n
}

// Deterministic 32-bit FNV-1a over a string → 8-char hex. Pure, no imports.
function fnv1aHex(input: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

// Latest evidence observedAt as epoch ms (for tie-breaking). 0 when none/unparseable.
function latestEvidenceMs(opp: Opportunity): number {
  let max = 0
  for (const e of opp.evidence) {
    const t = Date.parse(e.observedAt)
    if (!isNaN(t) && t > max) max = t
  }
  return max
}

function computePriority(band: PriorityBand, basePriority: number, urgency: number | undefined): number {
  return BAND_WEIGHTS[band] * 1000 + Math.trunc(basePriority) + clamp(urgency ?? 0, 0, 99)
}

// Total order, "better" first: priority -> confidence -> recent evidence -> lexical id.
function compareOpportunities(a: Opportunity, b: Opportunity): number {
  if (b.priority !== a.priority) return b.priority - a.priority
  const ca = CONFIDENCE_RANK[a.confidence]
  const cb = CONFIDENCE_RANK[b.confidence]
  if (cb !== ca) return cb - ca
  const ea = latestEvidenceMs(a)
  const eb = latestEvidenceMs(b)
  if (eb !== ea) return eb - ea
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

function buildOpportunity(
  detector: Detector,
  result: DetectionResult,
  context: DecisionContext,
): Opportunity {
  const now = context.metadata.assembledAt
  const blockedBy: BlockerRef[] = result.blockedBy ?? []
  const urgency = clamp(result.urgency ?? 0, 0, 99)
  const bandWeight = BAND_WEIGHTS[detector.priorityBand]
  const priority = computePriority(detector.priorityBand, detector.basePriority, result.urgency)

  return {
    id: `${context.tenantId}:${context.contactId}:${detector.opportunityType}:${result.anchorRef.kind}:${result.anchorRef.id}`,
    tenantId: context.tenantId,
    contactId: context.contactId,
    anchorRef: result.anchorRef,

    type: detector.opportunityType,
    recommendedPlaybook: detector.playbook,

    trigger: { detectorId: detector.id, summary: detector.name },
    evidence: result.evidence,

    priority,
    scoreBreakdown: {
      goalWeight: bandWeight, // V1: goalWeight === bandWeight (Goals layer deferred)
      band: detector.priorityBand,
      basePriority: detector.basePriority,
      urgency,
    },
    confidence: result.confidence,

    expectedImpact: result.expectedImpact ?? detector.estimates.impact,
    expectedCost: result.expectedCost ?? detector.estimates.cost,

    status: blockedBy.length > 0 ? 'SUPPRESSED' : 'ELIGIBLE',
    blockedBy,
    expiresAt: null,
    reactivationRuleRef: detector.reactivationRuleRef,

    detectorVersion: detector.version,
    scoringVersion: SCORING_VERSION,
    engineVersion: ENGINE_VERSION,
    schemaVersion: OPPORTUNITY_SCHEMA_VERSION,
    detectedAt: now,
  }
}

// Stable, canonical projection of the context for the replayable contextHash.
function contextHash(context: DecisionContext): string {
  const appts = context.appointments
    .map((a) => `${a.id}|${a.status ?? ''}|${a.slotDate ?? ''}|${a.reviewSentAt ?? ''}|${a.skipReview ?? ''}`)
    .join(',')
  const leads = context.leads.map((l) => `${l.id}|${l.status ?? ''}|${l.respondedAt ?? ''}|${l.createdAt ?? ''}`).join(',')
  const convs = context.conversations.map((c) => `${c.id}|${c.status ?? ''}|${c.createdAt ?? ''}`).join(',')
  const canonical = [
    context.tenantId,
    context.contactId,
    context.metadata.assembledAt,
    `A[${appts}]`,
    `L[${leads}]`,
    `C[${convs}]`,
  ].join('::')
  return fnv1aHex(canonical)
}

// ─── Public entry point ──────────────────────────────────────────────────────

/**
 * Pure deterministic decision: run every ENABLED detector over the context, build
 * + score opportunities, separate eligible vs suppressed (suppressed preserved),
 * select the single highest-priority eligible as primary, and record a full trace.
 * Never throws; detector errors become trace entries.
 */
export function decide(context: DecisionContext, registry: DetectorRegistry): Decision {
  const now = context.metadata.assembledAt
  const entries: DecisionTraceEntry[] = []
  const eligible: Opportunity[] = []
  const suppressed: Opportunity[] = []

  for (const detector of registry.listEnabled()) {
    let result: DetectionResult | null = null
    try {
      result = detector.detect(context)
    } catch (err) {
      entries.push({
        detectorId: detector.id,
        detectorVersion: detector.version,
        matched: false,
        reason: `error: ${errMessage(err)}`,
      })
      continue
    }

    if (!result) {
      entries.push({ detectorId: detector.id, detectorVersion: detector.version, matched: false, reason: 'no match' })
      continue
    }

    const opp = buildOpportunity(detector, result, context)
    if (opp.status === 'SUPPRESSED') {
      suppressed.push(opp)
      entries.push({
        detectorId: detector.id,
        detectorVersion: detector.version,
        matched: true,
        status: 'SUPPRESSED',
        score: opp.priority,
        blockedBy: opp.blockedBy,
        reason: `blocked by: ${opp.blockedBy.map((b) => b.code).join(', ')}`,
      })
    } else {
      eligible.push(opp)
      entries.push({
        detectorId: detector.id,
        detectorVersion: detector.version,
        matched: true,
        status: 'ELIGIBLE',
        score: opp.priority,
        reason: 'eligible',
      })
    }
  }

  const sortedEligible = [...eligible].sort(compareOpportunities)
  const sortedSuppressed = [...suppressed].sort(compareOpportunities)

  const trace: DecisionTrace = {
    entries,
    engineVersion: ENGINE_VERSION,
    scoringVersion: SCORING_VERSION,
    contextHash: contextHash(context),
    computedAt: now,
  }

  return {
    primary: sortedEligible[0] ?? null,
    eligible: sortedEligible,
    suppressed: sortedSuppressed,
    trace,
  }
}
