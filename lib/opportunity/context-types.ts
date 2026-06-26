// Business Opportunity Engine — Decision Context types (Sprint 4.2)
//
// PURE TYPE MODULE. Imports nothing; an island. `DecisionContext` is an engine
// *input* — a deterministic, read-only snapshot of everything known about ONE
// customer (contact) within ONE tenant at a single reference instant. It contains
// facts only (raw rows + neutral temporal/aggregate signals), never interpretations
// (no opportunities, scores, or decisions). It does NOT modify the frozen Sprint-4.1
// Opportunity output contract — it is a sibling input contract owned by this layer.

/** Load status of a single context data source. */
export type DataSourceStatus = 'ok' | 'empty' | 'error'

/** Per-source metadata — powers the future Inspector and Shadow tools. */
export interface ContextSourceMeta {
  status: DataSourceStatus
  count: number
  lastLoadedAt: string
  errorMessage?: string
}

// ─── Raw customer rows (light camelCase mapping of real columns; no logic) ───

export interface ContextContact {
  id: string
  name: string | null
  phone: string | null
  email: string | null
  language: string | null
  notes: string | null
  lastInteraction: string | null
  /** Raw, often-unreliable counter — detectors prefer signals.conversationCount. */
  totalConversations: number | null
  createdAt: string | null
}

export interface ContextAppointment {
  id: string
  status: string | null
  slotDate: string | null
  slotTime: string | null
  serviceType: string | null
  reviewSentAt: string | null
  skipReview: boolean | null
  channel: string | null
  customerEmail: string | null
  createdAt: string | null
}

export interface ContextLead {
  id: string
  status: string | null
  source: string | null
  name: string | null
  phone: string | null
  respondedAt: string | null
  createdAt: string | null
}

export interface ContextConversation {
  id: string
  status: string | null
  channel: string | null
  summary: string | null
  sentiment: string | null
  humanTakeover: boolean | null
  createdAt: string | null
}

// ─── Neutral computed signals (temporal / aggregate only — no interpretation) ─

export interface ContextSignals {
  daysSinceLastInteraction: number | null
  appointmentCount: number
  leadCount: number
  conversationCount: number
}

// ─── Source completeness/provenance ─────────────────────────────────────────

export interface ContextSources {
  contact: ContextSourceMeta
  appointments: ContextSourceMeta
  leads: ContextSourceMeta
  conversations: ContextSourceMeta
}

// ─── Operational load metadata (assembly concern, NOT business data) ─────────
//
// Kept separate from the business data: engines (Decision, Analytics, Company
// Brain, Voice Brain) reason about the business; Inspector/Shadow reason about how
// the context was assembled. `completeness` is ASSEMBLY completeness (fraction of
// sources that loaded without error) — it is NOT AI confidence.

export interface ContextMetadata {
  /** The single reference instant; all downstream temporal logic is relative to it. */
  assembledAt: string
  sources: ContextSources
  /** Deterministic fraction in [0,1] of sources that loaded without error. */
  completeness: number
  /** Deterministic notes about assembly (missing ids, load failures, contact not found). */
  warnings: string[]
}

// ─── The Decision Context (engine input) ────────────────────────────────────
//
// Business data (contact, appointments, leads, conversations, signals) is kept
// completely separate from operational load metadata.

export interface DecisionContext {
  tenantId: string
  contactId: string
  contact: ContextContact | null
  appointments: ContextAppointment[]
  leads: ContextLead[]
  conversations: ContextConversation[]
  signals: ContextSignals
  metadata: ContextMetadata
}
