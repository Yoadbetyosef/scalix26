import type { MilestoneDef } from './mission-milestones'

// Mission persistence: milestones (cc_mission_milestones) + headline mission TARGETS (reuse cc_targets with
// period='mission'). Founder-gated writes are audited. Milestone current/gap are DERIVED, never stored.

export interface MissionMilestoneRow extends MilestoneDef { id: string }
export type MilestonePatch = Partial<Pick<MilestoneDef, 'label' | 'targetValue' | 'targetDate' | 'sortOrder'>>
export const MISSION_PERIOD = 'mission'

export interface MissionDeps {
  getMilestones(): Promise<MissionMilestoneRow[]>
  getMilestone(id: string): Promise<MissionMilestoneRow | null>
  updateMilestone(id: string, patch: MilestonePatch, actor: string, at: string): Promise<void>
  getTargets(): Promise<Record<string, number>>
  upsertTarget(metricKey: string, value: number): Promise<void>
  addChange(entity: string, id: string, before: unknown, after: unknown, actor: string, at: string): Promise<void>
}

function fromRow(r: Record<string, unknown>): MissionMilestoneRow {
  return { id: r.id as string, key: r.key as string, label: r.label as string, kind: r.kind as MilestoneDef['kind'], metricKey: r.metric_key as string, targetValue: Number(r.target_value ?? 0), targetDate: (r.target_date as string) ?? null, sortOrder: Number(r.sort_order ?? 0) }
}

const dbDeps: MissionDeps = {
  async getMilestones() {
    const { createAdminClient } = await import('@/lib/supabase/server')
    const { data } = await createAdminClient().from('cc_mission_milestones').select('*').eq('status', 'active').order('sort_order')
    return ((data as Array<Record<string, unknown>> | null) ?? []).map(fromRow)
  },
  async getMilestone(id) {
    const { createAdminClient } = await import('@/lib/supabase/server')
    const { data } = await createAdminClient().from('cc_mission_milestones').select('*').eq('id', id).maybeSingle()
    return data ? fromRow(data as Record<string, unknown>) : null
  },
  async updateMilestone(id, patch, actor, at) {
    const { createAdminClient } = await import('@/lib/supabase/server')
    const m: Record<string, unknown> = { updated_by: actor, updated_at: at }
    if ('label' in patch) m.label = patch.label; if ('targetValue' in patch) m.target_value = patch.targetValue
    if ('targetDate' in patch) m.target_date = patch.targetDate; if ('sortOrder' in patch) m.sort_order = patch.sortOrder
    await createAdminClient().from('cc_mission_milestones').update(m).eq('id', id)
  },
  async getTargets() {
    const { createAdminClient } = await import('@/lib/supabase/server')
    const { data } = await createAdminClient().from('cc_targets').select('metric_key, target_value').eq('period', MISSION_PERIOD)
    const out: Record<string, number> = {}
    for (const r of (data as Array<{ metric_key: string; target_value: number }> | null) ?? []) out[r.metric_key] = Number(r.target_value)
    return out
  },
  async upsertTarget(metricKey, value) {
    const { createAdminClient } = await import('@/lib/supabase/server')
    await createAdminClient().from('cc_targets').upsert({ metric_key: metricKey, period: MISSION_PERIOD, target_value: value }, { onConflict: 'metric_key,period' })
  },
  async addChange(entity, id, before, after, actor, at) {
    const { createAdminClient } = await import('@/lib/supabase/server')
    await createAdminClient().from('cc_change_log').insert({ entity_type: entity, entity_id: id, changed_by: actor, changed_at: at, before_json: before, after_json: after })
  },
}
let deps: MissionDeps = dbDeps
export function __setMissionDepsForTests(d: MissionDeps | null) { deps = d ?? dbDeps }

export const getMissionMilestones = (): Promise<MissionMilestoneRow[]> => deps.getMilestones()
export const getMissionTargets = (): Promise<Record<string, number>> => deps.getTargets()

export async function saveMilestone(id: string, patch: MilestonePatch, actor: string): Promise<void> {
  const at = new Date().toISOString()
  const before = await deps.getMilestone(id)
  await deps.updateMilestone(id, patch, actor, at)
  await deps.addChange('mission_milestone', id, before, { ...before, ...patch }, actor, at)
}
export async function saveMissionTarget(metricKey: string, value: number, actor: string): Promise<void> {
  const at = new Date().toISOString()
  const before = await deps.getTargets()
  await deps.upsertTarget(metricKey, value)
  await deps.addChange('mission_target', metricKey, { [metricKey]: before[metricKey] ?? null }, { [metricKey]: value }, actor, at)
}
