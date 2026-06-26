// Business Opportunity Engine — Contract & Types (Sprint 4.1)
//
// PURE TYPE MODULE. This file is intentionally an island: it imports nothing and,
// as of this sprint, is imported by nothing in production. Everything here is erased
// at compile time — no runtime code, no enums, no const, no functions, no defaults.
//
// "Enums" are expressed as string-literal union types (zero runtime emit). Reserved
// Appendix Z fields are optional so later sprints can populate them without a contract
// break. This is the frozen contract every future engine component will depend on.

// ─── Supporting string-literal union types ("enums") ────────────────────────

/** The kind of business opportunity discovered for a customer. */
export type OpportunityType =
  | 'LEAD_RECOVERY'
  | 'REVIEW_REQUEST'
  | 'APPOINTMENT_RESCHEDULE'
  | 'ESTIMATE_FOLLOWUP'
  | 'UPSELL'
  | 'RETENTION'
  | 'COLLECTIONS'

/**
 * Lifecycle state of an opportunity. Reactivation is a *transition* back to
 * 'ELIGIBLE' (from 'SUPPRESSED' or 'EXPIRED'), not a distinct stored state.
 */
export type OpportunityStatus =
  | 'DETECTED'
  | 'ELIGIBLE'
  | 'SUPPRESSED'
  | 'SELECTED'
  | 'CAPTURED'
  | 'EXPIRED'
  | 'DISMISSED'

/** Deterministic confidence — a function of data completeness + recency, not probability. */
export type ConfidenceLevel = 'high' | 'medium' | 'low'

/** Coarse business-value band that drives priority ordering. */
export type PriorityBand =
  | 'collections'
  | 'owed_response'
  | 'reputation'
  | 'retention'
  | 'sales'
  | 'nurture'

/** Strategic value category an opportunity rolls up to (Appendix Z). */
export type BusinessValueCategory =
  | 'REVENUE'
  | 'REPUTATION'
  | 'RETENTION'
  | 'CASH_FLOW'
  | 'EFFICIENCY'

/** Declared magnitude band for impact/value (declared constant in V1). */
export type ValueMagnitude = 'low' | 'medium' | 'high'

/** The underlying fact an opportunity is "about" (used for identity + expiration). */
export type AnchorKind =
  | 'appointment'
  | 'lead'
  | 'conversation'
  | 'contact'
  | 'invoice' // reserved for COLLECTIONS

/**
 * Provenance basis of an economic estimate. Declared constants in V1; the union is
 * kept open so the future Learning phase can supply measured values without changing
 * the contract (e.g. a `measured:*` form).
 */
export type EstimateBasis = 'declared:v1' | (string & {})

// ─── Evidence types ─────────────────────────────────────────────────────────

/** A single fact the engine used, pointing at a real field/value/source. */
export interface Evidence {
  field: string
  value: string | number | boolean | null
  source: string
  observedAt: string
}

// ─── Blocker types ──────────────────────────────────────────────────────────

/**
 * A blocking condition currently tripped for an opportunity. `code` references a
 * Business Constraint code or, for opportunity-level blocks, an OpportunityType.
 */
export interface BlockerRef {
  code: string | OpportunityType
  reason: string
}

// ─── Identity & supporting structures ───────────────────────────────────────

/** Pointer to the underlying record the opportunity concerns. */
export interface AnchorRef {
  kind: AnchorKind
  id: string
}

/** What condition fired and a short human summary. */
export interface Trigger {
  detectorId: string
  summary: string
}

/** Fully itemized, deterministic score components (for explainability). */
export interface ScoreBreakdown {
  goalWeight: number
  band: PriorityBand
  basePriority: number
  urgency: number
}

/** Declared expected business effect of capturing this opportunity. */
export interface ExpectedImpact {
  kind: string
  magnitude: ValueMagnitude
  money?: number
  basis: EstimateBasis
}

/** Declared expected cost to act on this opportunity. */
export interface ExpectedCost {
  channel?: string
  units: number
  money: number
  ownerMinutes?: number
  basis: EstimateBasis
}

// ─── Reserved Appendix Z structures (optional in V1) ────────────────────────

/** Strategic value classification (reserved — Appendix Z, Business Value Model). */
export interface BusinessValue {
  category: BusinessValueCategory
  magnitude: ValueMagnitude
  basis: EstimateBasis
}

/** Declared dependency edges enabling opportunity chains (reserved — Appendix Z). */
export interface OpportunityDependencies {
  dependsOn: Array<OpportunityType | string>
  blockedBy: Array<OpportunityType | string>
  unlocks: OpportunityType[]
}

/** Declared consequence of inaction (reserved — Appendix Z). */
export interface CostOfInaction {
  consequence: string
  valueAtRisk: {
    category: BusinessValueCategory
    magnitude: ValueMagnitude
    basis: EstimateBasis
  }
  byWhen?: string
}

/** The four explainability answers every opportunity must surface (reserved — Appendix Z). */
export interface OpportunityExplanation {
  whyNow: string
  whyThis: string
  whyNotOther: string
  ifIgnored: string
}

// ─── The Opportunity object ─────────────────────────────────────────────────

/**
 * A discovered, durable business opportunity for a customer. Self-describing:
 * carries its own evidence, scoring, economics, lifecycle, and provenance.
 */
export interface Opportunity {
  // Identity
  id: string
  tenantId: string
  contactId: string
  anchorRef: AnchorRef

  // Classification
  type: OpportunityType
  recommendedPlaybook: string

  // Why it exists
  trigger: Trigger
  evidence: Evidence[]

  // Scoring (deterministic)
  priority: number
  scoreBreakdown: ScoreBreakdown
  confidence: ConfidenceLevel

  // Economics (declared constants in V1)
  expectedImpact: ExpectedImpact
  expectedCost: ExpectedCost

  // Eligibility & lifecycle
  status: OpportunityStatus
  blockedBy: BlockerRef[]
  expiresAt: string | null
  reactivationRuleRef: string

  // Versioning / provenance
  detectorVersion: number
  scoringVersion: number
  engineVersion: number
  schemaVersion: number
  detectedAt: string

  // Reserved (Appendix Z) — optional until later sprints populate them
  businessValue?: BusinessValue
  dependencies?: OpportunityDependencies
  costOfInaction?: CostOfInaction
  explain?: OpportunityExplanation
}

// ─── Decision types ─────────────────────────────────────────────────────────

/** Per-detector evaluation record, for the auditable decision trace. */
export interface DecisionTraceEntry {
  detectorId: string
  detectorVersion: number
  matched: boolean
  status: OpportunityStatus
  score?: number
  blockedBy?: BlockerRef[]
  reason?: string
}

/** The full, replayable trace of a single decision evaluation. */
export interface DecisionTrace {
  entries: DecisionTraceEntry[]
  engineVersion: number
  scoringVersion: number
  contextHash: string
  computedAt: string
}

/**
 * Output of the Decision Core: the single best opportunity plus the full ranked
 * eligible set and the preserved suppressed set (never discarded), with trace.
 */
export interface Decision {
  primary: Opportunity | null
  eligible: Opportunity[]
  suppressed: Opportunity[]
  trace: DecisionTrace
}
