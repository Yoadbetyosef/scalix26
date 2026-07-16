import { createClient } from '@/lib/supabase/server'
import { requireCommerceAccess } from './guard'
import { addCommerceEvent } from './events'
import { generateProjectNumber } from './number'

export async function listProjects() {
  const c = await requireCommerceAccess(); if (!c) return []
  const sb = await createClient()
  const { data } = await sb.from('commerce_projects').select('id, project_number, name, customer_name, status, project_type, updated_at').eq('tenant_id', c.tenantId).is('archived_at', null).order('updated_at', { ascending: false }).limit(200)
  return data ?? []
}

export async function createProject(input: { name: string; customerName?: string | null; projectType?: string | null }) {
  const c = await requireCommerceAccess(); if (!c) return { ok: false as const, error: 'unauthorized' }
  const sb = await createClient()
  const { data, error } = await sb.from('commerce_projects').insert({
    tenant_id: c.tenantId, project_number: generateProjectNumber(), name: input.name.trim(),
    customer_name: input.customerName ?? null, project_type: input.projectType ?? null, created_by: c.actor,
  }).select('id, project_number').single()
  if (error) return { ok: false as const, error: error.message }
  await addCommerceEvent(c.tenantId, 'project', data.id as string, 'created', { projectNumber: data.project_number }, c.actor)
  return { ok: true as const, project: data }
}
