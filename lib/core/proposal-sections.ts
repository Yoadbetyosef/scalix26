import { createAdminClient } from '@/lib/supabase/server'
import { editableFor } from './proposal-status'
import { logActivity } from './proposal-activity'

// Custom proposal sections (Project overview, Delivery, Warranty, Timeline, …). Content is plain multiline
// text (rendered escaped + pre-wrap — no unsafe HTML). Edits follow the proposal's lock rules.
const admin = () => createAdminClient()

async function assertEditable(tenantId: string, proposalId: string): Promise<boolean> {
  const { data } = await admin().from('proposals').select('status').eq('tenant_id', tenantId).eq('id', proposalId).maybeSingle()
  return !!data && editableFor(data.status as string)
}

export async function addSection(tenantId: string, proposalId: string, actor: string, input: { title?: string; body?: string; visible?: boolean }): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  if (!(await assertEditable(tenantId, proposalId))) return { ok: false, error: 'locked' }
  const { data: last } = await admin().from('proposal_sections').select('sort_order').eq('tenant_id', tenantId).eq('proposal_id', proposalId).order('sort_order', { ascending: false }).limit(1).maybeSingle()
  const { data, error } = await admin().from('proposal_sections').insert({ tenant_id: tenantId, proposal_id: proposalId, title: input.title ?? '', body: input.body ?? '', visible: input.visible ?? true, sort_order: ((last?.sort_order as number) ?? -1) + 1 }).select('id').single()
  if (error) return { ok: false, error: error.message }
  await logActivity(tenantId, proposalId, 'item_edited', { actor, message: 'Section added' })
  return { ok: true, id: data.id as string }
}

export async function updateSection(tenantId: string, proposalId: string, sectionId: string, patch: { title?: string; body?: string; visible?: boolean }): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!(await assertEditable(tenantId, proposalId))) return { ok: false, error: 'locked' }
  const upd: Record<string, unknown> = { updated_at: new Date().toISOString() }
  for (const k of ['title', 'body', 'visible'] as const) if (patch[k] !== undefined) upd[k] = patch[k]
  const { error } = await admin().from('proposal_sections').update(upd).eq('tenant_id', tenantId).eq('proposal_id', proposalId).eq('id', sectionId)
  return error ? { ok: false, error: error.message } : { ok: true }
}

export async function removeSection(tenantId: string, proposalId: string, sectionId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!(await assertEditable(tenantId, proposalId))) return { ok: false, error: 'locked' }
  await admin().from('proposal_sections').delete().eq('tenant_id', tenantId).eq('proposal_id', proposalId).eq('id', sectionId)
  return { ok: true }
}

export async function reorderSections(tenantId: string, proposalId: string, ids: string[]): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!(await assertEditable(tenantId, proposalId))) return { ok: false, error: 'locked' }
  await Promise.all(ids.map((id, i) => admin().from('proposal_sections').update({ sort_order: i }).eq('tenant_id', tenantId).eq('proposal_id', proposalId).eq('id', id)))
  return { ok: true }
}
