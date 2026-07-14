// Operating Plan store — the Mission→annual→quarterly→monthly→weekly→daily cascade. Founder-gated CRUD,
// audited before/after. Source-classified per row (manual by default).

export type PlanLevel = 'annual' | 'quarterly' | 'monthly' | 'weekly' | 'daily'
export type PlanStatus = 'not_started' | 'on_track' | 'at_risk' | 'off_track' | 'done'
export interface OperatingPlanRow {
  id: string; level: PlanLevel; objective: string; metricKey: string | null; baseline: number | null; target: number | null
  owner: string | null; startDate: string | null; dueDate: string | null; status: PlanStatus; progress: number
  notes: string | null; dependencies: string | null; growthEngine: string | null; playbook: string | null
  sourceClassification: string; confidence: string | null; updatedBy: string | null; updatedAt: string | null
}
export type PlanPatch = Partial<Omit<OperatingPlanRow, 'id' | 'updatedBy' | 'updatedAt'>>

export interface OperatingPlanDeps {
  getAll(): Promise<OperatingPlanRow[]>
  get(id: string): Promise<OperatingPlanRow | null>
  insert(patch: PlanPatch, actor: string, at: string): Promise<OperatingPlanRow>
  update(id: string, patch: PlanPatch, actor: string, at: string): Promise<void>
  remove(id: string): Promise<void>
  addChange(id: string, before: unknown, after: unknown, actor: string, at: string): Promise<void>
}

function fromRow(r: Record<string, unknown>): OperatingPlanRow {
  return { id: r.id as string, level: r.level as PlanLevel, objective: r.objective as string, metricKey: (r.metric_key as string) ?? null, baseline: r.baseline == null ? null : Number(r.baseline), target: r.target == null ? null : Number(r.target), owner: (r.owner as string) ?? null, startDate: (r.start_date as string) ?? null, dueDate: (r.due_date as string) ?? null, status: r.status as PlanStatus, progress: Number(r.progress ?? 0), notes: (r.notes as string) ?? null, dependencies: (r.dependencies as string) ?? null, growthEngine: (r.growth_engine as string) ?? null, playbook: (r.playbook as string) ?? null, sourceClassification: (r.source_classification as string) ?? 'manual', confidence: (r.confidence as string) ?? null, updatedBy: (r.updated_by as string) ?? null, updatedAt: (r.updated_at as string) ?? null }
}
function toRow(p: PlanPatch): Record<string, unknown> {
  const m: Record<string, unknown> = {}
  const map: Record<string, string> = { level: 'level', objective: 'objective', metricKey: 'metric_key', baseline: 'baseline', target: 'target', owner: 'owner', startDate: 'start_date', dueDate: 'due_date', status: 'status', progress: 'progress', notes: 'notes', dependencies: 'dependencies', growthEngine: 'growth_engine', playbook: 'playbook', sourceClassification: 'source_classification', confidence: 'confidence' }
  for (const [k, col] of Object.entries(map)) if (k in p) m[col] = (p as Record<string, unknown>)[k]
  return m
}

const dbDeps: OperatingPlanDeps = {
  async getAll() {
    const { createAdminClient } = await import('@/lib/supabase/server')
    const { data } = await createAdminClient().from('cc_operating_plan').select('*').order('due_date', { nullsFirst: false })
    return ((data as Array<Record<string, unknown>> | null) ?? []).map(fromRow)
  },
  async get(id) {
    const { createAdminClient } = await import('@/lib/supabase/server')
    const { data } = await createAdminClient().from('cc_operating_plan').select('*').eq('id', id).maybeSingle()
    return data ? fromRow(data as Record<string, unknown>) : null
  },
  async insert(patch, actor, at) {
    const { createAdminClient } = await import('@/lib/supabase/server')
    const { data } = await createAdminClient().from('cc_operating_plan').insert({ ...toRow(patch), updated_by: actor, updated_at: at }).select('*').single()
    return fromRow(data as Record<string, unknown>)
  },
  async update(id, patch, actor, at) {
    const { createAdminClient } = await import('@/lib/supabase/server')
    await createAdminClient().from('cc_operating_plan').update({ ...toRow(patch), updated_by: actor, updated_at: at }).eq('id', id)
  },
  async remove(id) {
    const { createAdminClient } = await import('@/lib/supabase/server')
    await createAdminClient().from('cc_operating_plan').delete().eq('id', id)
  },
  async addChange(id, before, after, actor, at) {
    const { createAdminClient } = await import('@/lib/supabase/server')
    await createAdminClient().from('cc_change_log').insert({ entity_type: 'operating_plan', entity_id: id, changed_by: actor, changed_at: at, before_json: before, after_json: after })
  },
}
let deps: OperatingPlanDeps = dbDeps
export function __setOperatingPlanDepsForTests(d: OperatingPlanDeps | null) { deps = d ?? dbDeps }

export const getOperatingPlan = (): Promise<OperatingPlanRow[]> => deps.getAll()

export async function saveOperatingPlan(id: string | null, patch: PlanPatch, actor: string): Promise<OperatingPlanRow> {
  const at = new Date().toISOString()
  if (!id) { const created = await deps.insert(patch, actor, at); await deps.addChange(created.id, null, created, actor, at); return created }
  const before = await deps.get(id)
  await deps.update(id, patch, actor, at)
  const after = { ...(before ?? {}), ...patch, updatedBy: actor, updatedAt: at }
  await deps.addChange(id, before, after, actor, at)
  return after as OperatingPlanRow
}
export async function deleteOperatingPlan(id: string, actor: string): Promise<void> {
  const at = new Date().toISOString()
  const before = await deps.get(id)
  if (!before) return
  await deps.remove(id)
  await deps.addChange(id, before, null, actor, at)
}
