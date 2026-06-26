import { createClient } from '@/lib/supabase/server'

// Customer Profile V1 (Sprint 001) — a READ-ONLY, additive view assembled purely
// from data that already exists (contacts / conversations / appointments / leads).
// It performs NO writes, NO LLM calls, and never uses the admin client. Every query
// is tenant-scoped and individually fail-safe; on any error or missing data it
// returns an empty profile, so the inbox behaves exactly as production does today.
//
// This is the foundation Customer Memory and Company Brain will later build on, but
// for now it only synthesizes existing facts — it invents nothing and stores nothing.

export type CustomerStage = 'new' | 'active' | 'returning' | 'dormant'

export interface ProfileSummaryItem {
  id: string
  channel: string
  summary: string
  dateLabel: string
}

export interface ProfileAppointmentItem {
  id: string
  serviceType: string | null
  status: string | null
  dateLabel: string
}

export interface CustomerProfile {
  /** When true the UI hides the block entirely (no data worth showing). */
  isEmpty: boolean
  name: string | null
  phone: string | null
  email: string | null
  language: string | null
  notes: string | null
  totalConversations: number | null
  lastInteractionLabel: string | null
  stage: CustomerStage | null
  stageLabel: string | null
  leadStatus: string | null
  recentSummaries: ProfileSummaryItem[]
  recentAppointments: ProfileAppointmentItem[]
}

const EMPTY_PROFILE: CustomerProfile = {
  isEmpty: true,
  name: null,
  phone: null,
  email: null,
  language: null,
  notes: null,
  totalConversations: null,
  lastInteractionLabel: null,
  stage: null,
  stageLabel: null,
  leadStatus: null,
  recentSummaries: [],
  recentAppointments: [],
}

// Deterministic, fixed-format date label computed server-side. Using a fixed locale
// keeps it stable (no hydration drift) and presentation out of the call sites.
function fmtDate(value: string | null | undefined): string | null {
  if (!value) return null
  const d = new Date(value)
  if (isNaN(d.getTime())) return null
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

// Stage is derived ONLY from hard facts (count + recency) — it is not an AI guess.
function deriveStage(
  totalConversations: number | null,
  lastInteraction: string | null
): { stage: CustomerStage | null; label: string | null } {
  if (!totalConversations || totalConversations <= 0) return { stage: null, label: null }
  if (totalConversations <= 1) return { stage: 'new', label: 'New customer' }
  const last = lastInteraction ? new Date(lastInteraction).getTime() : NaN
  if (!isNaN(last)) {
    const days = (Date.now() - last) / 86_400_000
    if (days <= 45) return { stage: 'active', label: 'Active' }
    if (days <= 180) return { stage: 'returning', label: 'Returning' }
    return { stage: 'dormant', label: 'Dormant' }
  }
  return { stage: 'returning', label: 'Returning' }
}

/**
 * Assemble a read-only Customer Profile for a contact within a tenant.
 * Always resolves — never throws. Returns EMPTY_PROFILE when there's nothing
 * meaningful to show (caller hides the block in that case).
 */
export async function getCustomerProfile(
  tenantId: string,
  contactId: string | null | undefined
): Promise<CustomerProfile> {
  if (!tenantId || !contactId) return EMPTY_PROFILE

  try {
    const supabase = await createClient()

    // Cheap, bounded, tenant-scoped reads in parallel. Each is independently
    // tolerant: a failure in one returns no rows rather than failing the whole
    // profile (PostgREST surfaces errors as { data: null } here).
    const [contactRes, summariesRes, apptsRes, leadRes] = await Promise.all([
      supabase
        .from('contacts')
        .select('name, phone, email, language, notes, last_interaction, total_conversations')
        .eq('id', contactId)
        .eq('tenant_id', tenantId)
        .maybeSingle(),
      supabase
        .from('conversations')
        .select('id, channel, summary, created_at')
        .eq('contact_id', contactId)
        .eq('tenant_id', tenantId)
        .not('summary', 'is', null)
        .order('created_at', { ascending: false })
        .limit(3),
      supabase
        .from('appointments')
        .select('id, service_type, status, slot_date, slot_time')
        .eq('contact_id', contactId)
        .eq('tenant_id', tenantId)
        .order('slot_date', { ascending: false })
        .limit(3),
      supabase
        .from('leads')
        .select('status, created_at')
        .eq('contact_id', contactId)
        .eq('tenant_id', tenantId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ])

    const c = contactRes.data
    const lead = leadRes.data

    const recentSummaries: ProfileSummaryItem[] = (summariesRes.data || [])
      .filter((s): s is { id: string; channel: string; summary: string; created_at: string } =>
        typeof s?.summary === 'string' && s.summary.trim().length > 0)
      .map((s) => ({
        id: s.id,
        channel: s.channel || '',
        summary: s.summary,
        dateLabel: fmtDate(s.created_at) || '',
      }))

    const recentAppointments: ProfileAppointmentItem[] = (apptsRes.data || []).map((a) => ({
      id: a.id,
      serviceType: a.service_type ?? null,
      status: a.status ?? null,
      dateLabel: fmtDate(a.slot_date) || '',
    }))

    const totalConversations = (c?.total_conversations ?? null) as number | null
    const lastInteraction = (c?.last_interaction ?? null) as string | null
    const notes = c?.notes && c.notes.trim() ? c.notes : null
    const language = c?.language || null
    const { stage, label: stageLabel } = deriveStage(totalConversations, lastInteraction)

    // "Has history" gates whether the block is shown at all. Bare identity
    // (name/phone) alone is already shown by the existing contact panel, so the
    // Customer Profile block only appears when it adds aggregate value.
    const hasHistory =
      recentSummaries.length > 0 ||
      recentAppointments.length > 0 ||
      !!lead?.status ||
      !!notes ||
      !!language ||
      (typeof totalConversations === 'number' && totalConversations > 0) ||
      !!lastInteraction

    if (!hasHistory) return EMPTY_PROFILE

    return {
      isEmpty: false,
      name: c?.name ?? null,
      phone: c?.phone ?? null,
      email: c?.email ?? null,
      language,
      notes,
      totalConversations,
      lastInteractionLabel: fmtDate(lastInteraction),
      stage,
      stageLabel,
      leadStatus: lead?.status ?? null,
      recentSummaries,
      recentAppointments,
    }
  } catch (err) {
    console.error('[customer/profile] assemble failed:', err)
    return EMPTY_PROFILE
  }
}
