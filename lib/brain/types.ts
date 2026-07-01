// ── Business Brain — Phase 1 types ────────────────────────────────────────────────
// Chain: raw data → signals → patterns → understanding (Business DNA) → recommendations.
// Deterministic only in Phase 1. No layer is ever skipped.

export type DnaStrand = 'sales' | 'pricing' | 'communication' | 'customer' | 'operations'
export const DNA_STRANDS: DnaStrand[] = ['sales', 'pricing', 'communication', 'customer', 'operations']
export const DNA_LABEL: Record<DnaStrand, string> = {
  sales: 'Sales DNA',
  pricing: 'Pricing DNA',
  communication: 'Communication DNA',
  customer: 'Customer DNA',
  operations: 'Operations DNA',
}

export type PatternCategory = 'response_time' | 'questions' | 'booking' | 'payment' | 'missed_opportunity' | 'channel'
export type EvidenceStrength = 'Low' | 'Medium' | 'High' | 'Very High'

// A deterministic fact found in real data (+ the timing needed to score confidence).
export interface Pattern {
  category: PatternCategory
  pattern_key: string
  title: string
  description: string
  metric_value: number | null
  metric_unit: string | null
  evidence_count: number
  evidence_refs: Record<string, unknown>
  weeks_observed: number
  consistency: number   // 0..1 — how steady over time
  outcome_ratio: number // 0..1 — how outcome-linked (payments/bookings) vs talk-only
}

export interface UnderstandingDraft {
  dna_strand: DnaStrand
  understanding_key: string
  title: string
  statement: string
  source_pattern_keys: string[]
  business_confidence: number
  evidence_strength: EvidenceStrength
  evidence_summary: string
}

export interface RecommendationDraft {
  understanding_key: string
  category: string
  title: string
  why: string
  how: string
  if_ignored: string
  estimated_impact: string | null
  business_confidence: number
  evidence_strength: EvidenceStrength
}

// Everything the detectors need, loaded once, tenant-scoped.
export interface BrainMsg { role: string; content: string; timestamp: string }
export interface BrainConv { id: string; channel: string | null; human_takeover: boolean | null; sentiment: string | null; status: string | null; created_at: string; contact_id: string | null }
export interface BrainData {
  now: number
  tenant: { stripe_connect_status?: string | null } & Record<string, unknown>
  conversations: BrainConv[]
  messagesByConv: Map<string, BrainMsg[]>
  leads: { status: string | null; source: string | null; created_at: string; responded_at: string | null }[]
  appointments: { status: string | null; channel: string | null; created_at: string; contact_id: string | null }[]
  payments: { status: string | null; amount: number | null; product_name: string | null; created_at: string }[]
  paymentRequests: { status: string | null; amount: number | null; created_at: string; conversation_id: string | null }[]
}
