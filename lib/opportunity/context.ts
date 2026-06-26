// Business Opportunity Engine — Context Provider (Sprint 4.2)
//
// The engine's SINGLE I/O layer. `assembleDecisionContext` reads existing data and
// produces a deterministic, read-only DecisionContext for one (tenant, contact).
// It does not detect, score, decide, or execute — it only assembles facts.
//
// Discipline: dependency-injected Supabase client (auth-agnostic); every query is
// tenant-scoped AND contact-scoped; reads are bounded; it NEVER throws (per-source
// isolation → degraded-but-well-formed context); `now` is injectable for determinism.
// This module is an island — nothing in production imports it as of this sprint.

import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  DecisionContext,
  ContextContact,
  ContextAppointment,
  ContextLead,
  ContextConversation,
  ContextSignals,
  ContextSources,
  ContextSourceMeta,
  ContextMetadata,
  DataSourceStatus,
} from './context-types'

// Bounded per-collection reads. A single contact never has many rows; caps are a
// safety ceiling, not an expected limit.
const APPOINTMENTS_LIMIT = 50
const LEADS_LIMIT = 50
const CONVERSATIONS_LIMIT = 50

// ─── Internal raw row shapes (snake_case, as stored) ────────────────────────

interface ContactRow {
  id: string
  name: string | null
  phone: string | null
  email: string | null
  language: string | null
  notes: string | null
  last_interaction: string | null
  total_conversations: number | null
  created_at: string | null
}

interface AppointmentRow {
  id: string
  status: string | null
  slot_date: string | null
  slot_time: string | null
  service_type: string | null
  review_sent_at: string | null
  skip_review: boolean | null
  channel: string | null
  customer_email: string | null
  created_at: string | null
}

interface LeadRow {
  id: string
  status: string | null
  source: string | null
  name: string | null
  phone: string | null
  responded_at: string | null
  created_at: string | null
}

interface ConversationRow {
  id: string
  status: string | null
  channel: string | null
  summary: string | null
  sentiment: string | null
  human_takeover: boolean | null
  created_at: string | null
}

// ─── Pure helpers ───────────────────────────────────────────────────────────

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function meta(status: DataSourceStatus, count: number, now: string, errorMessage?: string): ContextSourceMeta {
  return errorMessage ? { status, count, lastLoadedAt: now, errorMessage } : { status, count, lastLoadedAt: now }
}

function daysBetween(iso: string | null, now: string): number | null {
  if (!iso) return null
  const t = Date.parse(iso)
  const n = Date.parse(now)
  if (isNaN(t) || isNaN(n)) return null
  return Math.floor((n - t) / 86_400_000)
}

// Deterministic ordering: newest first, with a stable id tiebreak so output never
// depends on row arrival order or equal/null timestamps.
function byCreatedAtDesc<T extends { createdAt: string | null; id: string }>(a: T, b: T): number {
  const ta = a.createdAt ? Date.parse(a.createdAt) : NaN
  const tb = b.createdAt ? Date.parse(b.createdAt) : NaN
  const va = isNaN(ta) ? -Infinity : ta
  const vb = isNaN(tb) ? -Infinity : tb
  if (vb !== va) return vb - va
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

function emptyBusinessContext(tenantId: string, contactId: string, metadata: ContextMetadata): DecisionContext {
  const signals: ContextSignals = {
    daysSinceLastInteraction: null,
    appointmentCount: 0,
    leadCount: 0,
    conversationCount: 0,
  }
  return {
    tenantId,
    contactId,
    contact: null,
    appointments: [],
    leads: [],
    conversations: [],
    signals,
    metadata,
  }
}

function uniformSources(m: ContextSourceMeta): ContextSources {
  return { contact: { ...m }, appointments: { ...m }, leads: { ...m }, conversations: { ...m } }
}

// Assembly completeness: fraction of sources that loaded without error (always /4).
function computeCompleteness(sources: ContextSources): number {
  const all = [sources.contact, sources.appointments, sources.leads, sources.conversations]
  const loaded = all.filter((s) => s.status !== 'error').length
  return loaded / all.length
}

// Deterministic, human-readable assembly notes derived purely from source statuses.
function deriveWarnings(sources: ContextSources): string[] {
  const warnings: string[] = []
  const labelled: Array<[keyof ContextSources, string]> = [
    ['contact', 'contact'],
    ['appointments', 'appointments'],
    ['leads', 'leads'],
    ['conversations', 'conversations'],
  ]
  for (const [key, label] of labelled) {
    const s = sources[key]
    if (s.status === 'error') warnings.push(`Failed to load ${label}: ${s.errorMessage ?? 'unknown error'}`)
  }
  if (sources.contact.status === 'empty') warnings.push('Contact not found.')
  return warnings
}

function buildMetadata(now: string, sources: ContextSources): ContextMetadata {
  return {
    assembledAt: now,
    sources,
    completeness: computeCompleteness(sources),
    warnings: deriveWarnings(sources),
  }
}

// ─── Per-source reads (each independently guarded; never throws) ─────────────

async function loadContact(
  client: SupabaseClient,
  tenantId: string,
  contactId: string,
  now: string,
): Promise<{ data: ContextContact | null; meta: ContextSourceMeta }> {
  try {
    const { data, error } = await client
      .from('contacts')
      .select('id, name, phone, email, language, notes, last_interaction, total_conversations, created_at')
      .eq('id', contactId)
      .eq('tenant_id', tenantId)
      .maybeSingle()
    if (error) return { data: null, meta: meta('error', 0, now, error.message) }
    const row = (data as ContactRow | null) ?? null
    if (!row) return { data: null, meta: meta('empty', 0, now) }
    const contact: ContextContact = {
      id: row.id,
      name: row.name ?? null,
      phone: row.phone ?? null,
      email: row.email ?? null,
      language: row.language ?? null,
      notes: row.notes ?? null,
      lastInteraction: row.last_interaction ?? null,
      totalConversations: row.total_conversations ?? null,
      createdAt: row.created_at ?? null,
    }
    return { data: contact, meta: meta('ok', 1, now) }
  } catch (err) {
    return { data: null, meta: meta('error', 0, now, errMessage(err)) }
  }
}

async function loadAppointments(
  client: SupabaseClient,
  tenantId: string,
  contactId: string,
  now: string,
): Promise<{ data: ContextAppointment[]; meta: ContextSourceMeta }> {
  try {
    const { data, error } = await client
      .from('appointments')
      .select('id, status, slot_date, slot_time, service_type, review_sent_at, skip_review, channel, customer_email, created_at')
      .eq('tenant_id', tenantId)
      .eq('contact_id', contactId)
      .order('created_at', { ascending: false })
      .limit(APPOINTMENTS_LIMIT)
    if (error) return { data: [], meta: meta('error', 0, now, error.message) }
    const rows = (data as AppointmentRow[] | null) ?? []
    const mapped: ContextAppointment[] = rows.map((r) => ({
      id: r.id,
      status: r.status ?? null,
      slotDate: r.slot_date ?? null,
      slotTime: r.slot_time ?? null,
      serviceType: r.service_type ?? null,
      reviewSentAt: r.review_sent_at ?? null,
      skipReview: r.skip_review ?? null,
      channel: r.channel ?? null,
      customerEmail: r.customer_email ?? null,
      createdAt: r.created_at ?? null,
    }))
    return { data: mapped, meta: meta(mapped.length ? 'ok' : 'empty', mapped.length, now) }
  } catch (err) {
    return { data: [], meta: meta('error', 0, now, errMessage(err)) }
  }
}

async function loadLeads(
  client: SupabaseClient,
  tenantId: string,
  contactId: string,
  now: string,
): Promise<{ data: ContextLead[]; meta: ContextSourceMeta }> {
  try {
    const { data, error } = await client
      .from('leads')
      .select('id, status, source, name, phone, responded_at, created_at')
      .eq('tenant_id', tenantId)
      .eq('contact_id', contactId)
      .order('created_at', { ascending: false })
      .limit(LEADS_LIMIT)
    if (error) return { data: [], meta: meta('error', 0, now, error.message) }
    const rows = (data as LeadRow[] | null) ?? []
    const mapped: ContextLead[] = rows.map((r) => ({
      id: r.id,
      status: r.status ?? null,
      source: r.source ?? null,
      name: r.name ?? null,
      phone: r.phone ?? null,
      respondedAt: r.responded_at ?? null,
      createdAt: r.created_at ?? null,
    }))
    return { data: mapped, meta: meta(mapped.length ? 'ok' : 'empty', mapped.length, now) }
  } catch (err) {
    return { data: [], meta: meta('error', 0, now, errMessage(err)) }
  }
}

async function loadConversations(
  client: SupabaseClient,
  tenantId: string,
  contactId: string,
  now: string,
): Promise<{ data: ContextConversation[]; meta: ContextSourceMeta }> {
  try {
    const { data, error } = await client
      .from('conversations')
      .select('id, status, channel, summary, sentiment, human_takeover, created_at')
      .eq('tenant_id', tenantId)
      .eq('contact_id', contactId)
      .order('created_at', { ascending: false })
      .limit(CONVERSATIONS_LIMIT)
    if (error) return { data: [], meta: meta('error', 0, now, error.message) }
    const rows = (data as ConversationRow[] | null) ?? []
    const mapped: ContextConversation[] = rows.map((r) => ({
      id: r.id,
      status: r.status ?? null,
      channel: r.channel ?? null,
      summary: r.summary ?? null,
      sentiment: r.sentiment ?? null,
      humanTakeover: r.human_takeover ?? null,
      createdAt: r.created_at ?? null,
    }))
    return { data: mapped, meta: meta(mapped.length ? 'ok' : 'empty', mapped.length, now) }
  } catch (err) {
    return { data: [], meta: meta('error', 0, now, errMessage(err)) }
  }
}

// ─── Public entry point ─────────────────────────────────────────────────────

/**
 * Assemble a deterministic DecisionContext for one (tenant, contact).
 * Never throws. Returns a well-formed empty context when ids are missing, a
 * degraded (per-source error-flagged) context on read failures, and a complete
 * context otherwise. `now` is injectable for deterministic, reproducible output.
 */
export async function assembleDecisionContext(
  client: SupabaseClient,
  params: { tenantId: string; contactId: string; now?: string },
): Promise<DecisionContext> {
  const now = params?.now ?? new Date().toISOString()
  const tenantId = params?.tenantId ?? ''
  const contactId = params?.contactId ?? ''

  // Guard: no identity → well-formed empty context, no queries issued.
  if (!tenantId || !contactId) {
    const reason = !tenantId && !contactId
      ? 'Missing tenantId and contactId'
      : !tenantId ? 'Missing tenantId' : 'Missing contactId'
    const sources = uniformSources(meta('error', 0, now, `${reason}; not loaded`))
    const warnings: string[] = []
    if (!tenantId) warnings.push('Missing tenantId; no data loaded.')
    if (!contactId) warnings.push('Missing contactId; no data loaded.')
    return emptyBusinessContext(tenantId, contactId, { assembledAt: now, sources, completeness: 0, warnings })
  }

  try {
    const [contactRes, apptRes, leadRes, convRes] = await Promise.all([
      loadContact(client, tenantId, contactId, now),
      loadAppointments(client, tenantId, contactId, now),
      loadLeads(client, tenantId, contactId, now),
      loadConversations(client, tenantId, contactId, now),
    ])

    const appointments = [...apptRes.data].sort(byCreatedAtDesc)
    const leads = [...leadRes.data].sort(byCreatedAtDesc)
    const conversations = [...convRes.data].sort(byCreatedAtDesc)

    const signals: ContextSignals = {
      daysSinceLastInteraction: daysBetween(contactRes.data?.lastInteraction ?? null, now),
      appointmentCount: appointments.length,
      leadCount: leads.length,
      conversationCount: conversations.length,
    }

    const sources: ContextSources = {
      contact: contactRes.meta,
      appointments: apptRes.meta,
      leads: leadRes.meta,
      conversations: convRes.meta,
    }

    return {
      tenantId,
      contactId,
      contact: contactRes.data,
      appointments,
      leads,
      conversations,
      signals,
      metadata: buildMetadata(now, sources),
    }
  } catch (err) {
    // Catastrophic/unexpected — still return a well-formed, error-flagged context.
    const message = errMessage(err)
    const sources = uniformSources(meta('error', 0, now, message))
    return emptyBusinessContext(tenantId, contactId, {
      assembledAt: now,
      sources,
      completeness: 0,
      warnings: [`Context assembly failed: ${message}`],
    })
  }
}
