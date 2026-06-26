// Business Opportunity Engine — Detector Framework (Sprint 4.3)
//
// PURE TYPE MODULE (island). Defines the detector *plugin* contract: a detector is a
// self-describing manifest plus a single pure detection method — not just a function.
//
// A detector NEVER does I/O, reads the wall clock, uses randomness, mutates the
// context, calls other detectors/the registry, scores/ranks, throws, persists, or
// executes. Determinism is enforced structurally: `detect` is SYNCHRONOUS and its only
// input is the deterministic DecisionContext (whose `now` is frozen as assembledAt),
// so it cannot perform I/O or read a clock.
//
// A detector returns a DetectionResult (a raw match), not a full Opportunity. A later
// sprint's Decision Core combines DetectorMetadata + DetectionResult into an Opportunity.

import type {
  OpportunityType,
  OpportunityStatus,
  PriorityBand,
  ExpectedImpact,
  ExpectedCost,
  AnchorRef,
  Evidence,
  ConfidenceLevel,
  BlockerRef,
} from './types'
import type { DecisionContext } from './context-types'

/** Maturity of the detector itself (distinct from the opportunity lifecycle state). */
export type DetectorStatus = 'active' | 'experimental' | 'deprecated'

/** The self-describing plugin manifest every detector exposes. */
export interface DetectorMetadata {
  /** Stable, namespaced identifier, e.g. "review_request.after_completion". */
  id: string
  name: string
  description: string
  version: number

  /**
   * One-sentence business objective, e.g. "Recover abandoned leads". DESCRIPTIVE
   * ONLY — must never influence detection logic. For Inspector/docs/dashboard/search.
   */
  goal: string
  /**
   * Stable taxonomy tags, e.g. ["reviews","reputation"]. DESCRIPTIVE ONLY — must never
   * influence detection logic. For catalog browsing, search, and analytics.
   */
  tags: readonly string[]

  /** The kind of opportunity this detector discovers. */
  opportunityType: OpportunityType
  /** Recommended execution strategy (downstream phase). */
  playbook: string

  /** Declared priority band + base order — constants, NOT computed scores. */
  priorityBand: PriorityBand
  basePriority: number

  /** The lifecycle state results enter at (V1 detection emits 'DETECTED'). */
  emittedStatus: OpportunityStatus

  /** Detector maturity. Enable/disable is expressed via status, not registry mutation. */
  status: DetectorStatus
  /** Owning team or person. */
  owner: string

  /** Verticals this detector applies to ('all' by default). */
  supportedBusinessTypes: string[] | 'all'

  /** Declared (constant) economics; a DetectionResult may override per-detection. */
  estimates: { impact: ExpectedImpact; cost: ExpectedCost }

  /** Opaque named lifecycle policies (shapes defined in the Lifecycle sprint). */
  expirationRuleRef?: string
  reactivationRuleRef: string
}

/**
 * A detector's raw output for a single context — the building blocks of an
 * Opportunity, without any scoring or final priority. The Decision Core assembles
 * the Opportunity from this plus the detector's metadata.
 */
export interface DetectionResult {
  anchorRef: AnchorRef
  evidence: Evidence[]
  confidence: ConfidenceLevel
  /** Bounded dynamic signal (e.g. days overdue); optional. */
  urgency?: number
  /** Optional per-detection overrides of the detector's declared estimates. */
  expectedImpact?: ExpectedImpact
  expectedCost?: ExpectedCost
  /** Blocking conditions discovered during detection (else declared elsewhere). */
  blockedBy?: BlockerRef[]
}

/** The plugin: manifest + a single pure, synchronous detection method. */
export interface Detector extends DetectorMetadata {
  detect(context: DecisionContext): DetectionResult | null
}
