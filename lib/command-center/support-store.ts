import { emptySupportOverlay, type SupportOverlay } from './support-ops'

// Persistence + audit for the manual support/operational overlay (cc_support_overlay). Metadata only — no
// conversation/message content. Every mutation is audited before/after to cc_change_log. DB access is behind
// an injectable seam so the store is unit-testable with no database.

export type SupportOverlayPatch = Partial<Omit<SupportOverlay, 'signalId' | 'updatedBy' | 'updatedAt'>>

export interface SupportStoreDeps {
  getAll(): Promise<SupportOverlay[]>
  get(signalId: string): Promise<SupportOverlay | null>
  upsert(signalId: string, patch: SupportOverlayPatch, actor: string, at: string): Promise<void>
  remove(signalId: string): Promise<void>
  addChange(signalId: string, before: unknown, after: unknown, actor: string, at: string): Promise<void>
}

function fromRow(r: Record<string, unknown>): SupportOverlay {
  return { signalId: r.signal_id as string, owner: (r.owner as string) ?? null, issueType: (r.issue_type as string) ?? null, severity: (r.severity as SupportOverlay['severity']) ?? null, status: (r.status as string) ?? null, notes: (r.notes as string) ?? null, resolutionNote: (r.resolution_note as string) ?? null, updatedBy: (r.updated_by as string) ?? null, updatedAt: (r.updated_at as string) ?? null }
}
function toRow(p: SupportOverlayPatch): Record<string, unknown> {
  const m: Record<string, unknown> = {}
  if ('owner' in p) m.owner = p.owner; if ('issueType' in p) m.issue_type = p.issueType; if ('severity' in p) m.severity = p.severity
  if ('status' in p) m.status = p.status; if ('notes' in p) m.notes = p.notes; if ('resolutionNote' in p) m.resolution_note = p.resolutionNote
  return m
}

const dbDeps: SupportStoreDeps = {
  async getAll() {
    const { createAdminClient } = await import('@/lib/supabase/server')
    const { data } = await createAdminClient().from('cc_support_overlay').select('*')
    return ((data as Array<Record<string, unknown>> | null) ?? []).map(fromRow)
  },
  async get(signalId) {
    const { createAdminClient } = await import('@/lib/supabase/server')
    const { data } = await createAdminClient().from('cc_support_overlay').select('*').eq('signal_id', signalId).maybeSingle()
    return data ? fromRow(data as Record<string, unknown>) : null
  },
  async upsert(signalId, patch, actor, at) {
    const { createAdminClient } = await import('@/lib/supabase/server')
    await createAdminClient().from('cc_support_overlay').upsert({ signal_id: signalId, ...toRow(patch), updated_by: actor, updated_at: at }, { onConflict: 'signal_id' })
  },
  async remove(signalId) {
    const { createAdminClient } = await import('@/lib/supabase/server')
    await createAdminClient().from('cc_support_overlay').delete().eq('signal_id', signalId)
  },
  async addChange(signalId, before, after, actor, at) {
    const { createAdminClient } = await import('@/lib/supabase/server')
    await createAdminClient().from('cc_change_log').insert({ entity_type: 'support_overlay', entity_id: signalId, changed_by: actor, changed_at: at, before_json: before, after_json: after })
  },
}
let deps: SupportStoreDeps = dbDeps
export function __setSupportStoreDepsForTests(d: SupportStoreDeps | null) { deps = d ?? dbDeps }

export const getSupportOverlays = (): Promise<SupportOverlay[]> => deps.getAll()

export async function saveSupportOverlay(signalId: string, patch: SupportOverlayPatch, actor: string): Promise<SupportOverlay> {
  const at = new Date().toISOString()
  const before = (await deps.get(signalId)) ?? emptySupportOverlay(signalId)
  await deps.upsert(signalId, patch, actor, at)
  const after = { ...before, ...patch, updatedBy: actor, updatedAt: at }
  await deps.addChange(signalId, before, after, actor, at)
  return after
}
export async function clearSupportOverlay(signalId: string, actor: string): Promise<void> {
  const at = new Date().toISOString()
  const before = await deps.get(signalId)
  if (!before) return
  await deps.remove(signalId)
  await deps.addChange(signalId, before, null, actor, at)
}
