import { createAdminClient } from '@/lib/supabase/server'
import type { Activity } from './types'

// Unified, first-class activity timeline. Any Core module records here so a contact/record timeline is a
// single query (replacing the old read-time fan-out). Tenant-scoped.
const admin = () => createAdminClient()

export interface ActivityInput {
  contactId?: string | null; companyId?: string | null
  subjectType?: string | null; subjectId?: string | null
  type: string; title?: string | null; body?: string | null
  actor?: string | null; metadata?: Record<string, unknown>; occurredAt?: string
}

export async function addActivity(tenantId: string, a: ActivityInput): Promise<Activity | null> {
  const { data } = await admin().from('activities').insert({
    tenant_id: tenantId, contact_id: a.contactId ?? null, company_id: a.companyId ?? null,
    subject_type: a.subjectType ?? null, subject_id: a.subjectId ?? null,
    type: a.type, title: a.title ?? null, body: a.body ?? null,
    actor_user_id: a.actor ?? null, metadata: a.metadata ?? {}, occurred_at: a.occurredAt ?? new Date().toISOString(),
  }).select('*').single()
  return (data as Activity | null) ?? null
}

export async function getContactTimeline(tenantId: string, contactId: string, limit = 100): Promise<Activity[]> {
  const { data } = await admin().from('activities').select('*').eq('tenant_id', tenantId).eq('contact_id', contactId).order('occurred_at', { ascending: false }).limit(limit)
  return (data as Activity[]) ?? []
}

export async function getSubjectTimeline(tenantId: string, subjectType: string, subjectId: string, limit = 100): Promise<Activity[]> {
  const { data } = await admin().from('activities').select('*').eq('tenant_id', tenantId).eq('subject_type', subjectType).eq('subject_id', subjectId).order('occurred_at', { ascending: false }).limit(limit)
  return (data as Activity[]) ?? []
}
