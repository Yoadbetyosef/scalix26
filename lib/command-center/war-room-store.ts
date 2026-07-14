import type { WarRoomGap, TaskScope, TaskPriority } from './war-room'

// War Room task store — persists founder-accepted gaps and founder-created tasks. Accepting a gap is an
// explicit write (never on read). gap_key de-dupes accepted gaps against live ones. Audited before/after.

export type TaskStatus = 'open' | 'in_progress' | 'done' | 'dismissed'
export interface WarRoomTask {
  id: string; scope: TaskScope; title: string; category: string; requiredResult: number | null; actual: number | null
  owner: string | null; deadline: string | null; priority: TaskPriority; expectedImpactCents: number | null
  playbook: string | null; status: TaskStatus; dismissReason: string | null; source: 'generated' | 'manual'
  gapKey: string | null; updatedBy: string | null; updatedAt: string | null
}
export type TaskPatch = Partial<Omit<WarRoomTask, 'id' | 'updatedBy' | 'updatedAt'>>

export interface WarRoomDeps {
  getAll(): Promise<WarRoomTask[]>
  get(id: string): Promise<WarRoomTask | null>
  insert(patch: TaskPatch, actor: string, at: string): Promise<WarRoomTask>
  update(id: string, patch: TaskPatch, actor: string, at: string): Promise<void>
  addChange(id: string, before: unknown, after: unknown, actor: string, at: string): Promise<void>
}

function fromRow(r: Record<string, unknown>): WarRoomTask {
  return { id: r.id as string, scope: r.scope as TaskScope, title: r.title as string, category: r.category as string, requiredResult: r.required_result == null ? null : Number(r.required_result), actual: r.actual == null ? null : Number(r.actual), owner: (r.owner as string) ?? null, deadline: (r.deadline as string) ?? null, priority: r.priority as TaskPriority, expectedImpactCents: r.expected_impact_cents == null ? null : Number(r.expected_impact_cents), playbook: (r.playbook as string) ?? null, status: r.status as TaskStatus, dismissReason: (r.dismiss_reason as string) ?? null, source: r.source as 'generated' | 'manual', gapKey: (r.gap_key as string) ?? null, updatedBy: (r.updated_by as string) ?? null, updatedAt: (r.updated_at as string) ?? null }
}
function toRow(p: TaskPatch): Record<string, unknown> {
  const m: Record<string, unknown> = {}
  const map: Record<string, string> = { scope: 'scope', title: 'title', category: 'category', requiredResult: 'required_result', actual: 'actual', owner: 'owner', deadline: 'deadline', priority: 'priority', expectedImpactCents: 'expected_impact_cents', playbook: 'playbook', status: 'status', dismissReason: 'dismiss_reason', source: 'source', gapKey: 'gap_key' }
  for (const [k, col] of Object.entries(map)) if (k in p) m[col] = (p as Record<string, unknown>)[k]
  return m
}

const dbDeps: WarRoomDeps = {
  async getAll() {
    const { createAdminClient } = await import('@/lib/supabase/server')
    const { data } = await createAdminClient().from('cc_war_room_tasks').select('*').order('created_at', { ascending: false })
    return ((data as Array<Record<string, unknown>> | null) ?? []).map(fromRow)
  },
  async get(id) {
    const { createAdminClient } = await import('@/lib/supabase/server')
    const { data } = await createAdminClient().from('cc_war_room_tasks').select('*').eq('id', id).maybeSingle()
    return data ? fromRow(data as Record<string, unknown>) : null
  },
  async insert(patch, actor, at) {
    const { createAdminClient } = await import('@/lib/supabase/server')
    const { data, error } = await createAdminClient().from('cc_war_room_tasks').insert({ ...toRow(patch), updated_by: actor, updated_at: at }).select('*').single()
    if (error) throw new Error(error.message)
    return fromRow(data as Record<string, unknown>)
  },
  async update(id, patch, actor, at) {
    const { createAdminClient } = await import('@/lib/supabase/server')
    await createAdminClient().from('cc_war_room_tasks').update({ ...toRow(patch), updated_by: actor, updated_at: at }).eq('id', id)
  },
  async addChange(id, before, after, actor, at) {
    const { createAdminClient } = await import('@/lib/supabase/server')
    await createAdminClient().from('cc_change_log').insert({ entity_type: 'war_room_task', entity_id: id, changed_by: actor, changed_at: at, before_json: before, after_json: after })
  },
}
let deps: WarRoomDeps = dbDeps
export function __setWarRoomDepsForTests(d: WarRoomDeps | null) { deps = d ?? dbDeps }

export const getWarRoomTasks = (): Promise<WarRoomTask[]> => deps.getAll()

export async function acceptGap(gap: WarRoomGap, actor: string): Promise<WarRoomTask> {
  const at = new Date().toISOString()
  const created = await deps.insert({ scope: gap.scope, title: gap.title, category: gap.category, requiredResult: gap.requiredResult, actual: null, priority: gap.priority, expectedImpactCents: gap.expectedImpactCents, playbook: gap.playbook, status: 'open', source: 'generated', gapKey: gap.gapKey }, actor, at)
  await deps.addChange(created.id, null, created, actor, at)
  return created
}
export async function saveTask(id: string | null, patch: TaskPatch, actor: string): Promise<WarRoomTask> {
  const at = new Date().toISOString()
  if (!id) { const created = await deps.insert({ ...patch, source: patch.source ?? 'manual', status: patch.status ?? 'open' }, actor, at); await deps.addChange(created.id, null, created, actor, at); return created }
  const before = await deps.get(id)
  await deps.update(id, patch, actor, at)
  const after = { ...(before ?? {}), ...patch, updatedBy: actor, updatedAt: at }
  await deps.addChange(id, before, after, actor, at)
  return after as WarRoomTask
}
