import { emptyOverlay, type OnboardingOverlay, type OverlayPatch } from './queue-logic'

// Manual operational overlay STORE (persistence + audit). The overlay is the human operating layer ON TOP
// of the system-observed stage and NEVER mutates it. Every mutation is audited (before/after →
// cc_change_log). DB access is behind an injectable seam so the store is unit-testable with no database.
// Pure queue logic (filter/sort/types) lives in queue-logic.ts and is re-exported here for convenience.

export * from './queue-logic'
export type { OnboardingOverlay, OverlayPatch }

export interface OverlayDeps {
  getAll(): Promise<OnboardingOverlay[]>
  get(tenantId: string): Promise<OnboardingOverlay | null>
  upsert(tenantId: string, patch: OverlayPatch, actor: string, at: string): Promise<void>
  remove(tenantId: string): Promise<void>
  addChange(tenantId: string, before: unknown, after: unknown, actor: string, at: string): Promise<void>
}

function fromRow(r: Record<string, unknown>): OnboardingOverlay {
  return { tenantId: r.tenant_id as string, owner: (r.owner as string) ?? null, manualStage: (r.manual_stage as string) ?? null, blocker: (r.blocker as string) ?? null, blockerNotes: (r.blocker_notes as string) ?? null, slaDueDate: (r.sla_due_date as string) ?? null, priority: (r.priority as OnboardingOverlay['priority']) ?? null, nextAction: (r.next_action as string) ?? null, followUpDate: (r.follow_up_date as string) ?? null, status: (r.status as string) ?? null, resolutionNote: (r.resolution_note as string) ?? null, updatedBy: (r.updated_by as string) ?? null, updatedAt: (r.updated_at as string) ?? null }
}
function toRow(p: OverlayPatch): Record<string, unknown> {
  const m: Record<string, unknown> = {}
  if ('owner' in p) m.owner = p.owner; if ('manualStage' in p) m.manual_stage = p.manualStage; if ('blocker' in p) m.blocker = p.blocker
  if ('blockerNotes' in p) m.blocker_notes = p.blockerNotes; if ('slaDueDate' in p) m.sla_due_date = p.slaDueDate; if ('priority' in p) m.priority = p.priority
  if ('nextAction' in p) m.next_action = p.nextAction; if ('followUpDate' in p) m.follow_up_date = p.followUpDate; if ('status' in p) m.status = p.status
  if ('resolutionNote' in p) m.resolution_note = p.resolutionNote
  return m
}

const dbDeps: OverlayDeps = {
  async getAll() {
    const { createAdminClient } = await import('@/lib/supabase/server')
    const { data } = await createAdminClient().from('cc_onboarding_overlay').select('*')
    return ((data as Array<Record<string, unknown>> | null) ?? []).map(fromRow)
  },
  async get(tenantId) {
    const { createAdminClient } = await import('@/lib/supabase/server')
    const { data } = await createAdminClient().from('cc_onboarding_overlay').select('*').eq('tenant_id', tenantId).maybeSingle()
    return data ? fromRow(data as Record<string, unknown>) : null
  },
  async upsert(tenantId, patch, actor, at) {
    const { createAdminClient } = await import('@/lib/supabase/server')
    await createAdminClient().from('cc_onboarding_overlay').upsert({ tenant_id: tenantId, ...toRow(patch), updated_by: actor, updated_at: at }, { onConflict: 'tenant_id' })
  },
  async remove(tenantId) {
    const { createAdminClient } = await import('@/lib/supabase/server')
    await createAdminClient().from('cc_onboarding_overlay').delete().eq('tenant_id', tenantId)
  },
  async addChange(tenantId, before, after, actor, at) {
    const { createAdminClient } = await import('@/lib/supabase/server')
    await createAdminClient().from('cc_change_log').insert({ entity_type: 'onboarding_overlay', entity_id: tenantId, changed_by: actor, changed_at: at, before_json: before, after_json: after })
  },
}
let deps: OverlayDeps = dbDeps
export function __setOverlayDepsForTests(d: OverlayDeps | null) { deps = d ?? dbDeps }

export const getOverlays = (): Promise<OnboardingOverlay[]> => deps.getAll()

export async function saveOverlay(tenantId: string, patch: OverlayPatch, actor: string): Promise<OnboardingOverlay> {
  const at = new Date().toISOString()
  const before = (await deps.get(tenantId)) ?? emptyOverlay(tenantId)
  await deps.upsert(tenantId, patch, actor, at)
  const after = { ...before, ...patch, updatedBy: actor, updatedAt: at }
  await deps.addChange(tenantId, before, after, actor, at)
  return after
}
export async function clearOverlay(tenantId: string, actor: string): Promise<void> {
  const at = new Date().toISOString()
  const before = await deps.get(tenantId)
  if (!before) return
  await deps.remove(tenantId)
  await deps.addChange(tenantId, before, null, actor, at)
}
