import type { HiringPlanRole } from './capacity-v2'

// PLAN store — future hires. Edited in place (audited). "Move to Team Reality" is an explicit founder action
// that runs the atomic DB function cc_move_hire_to_reality (creates the effective reality row, marks the plan
// hired, and audits BOTH in one transaction). Planned payroll is never mixed into reality.

export type HiringPlanPatch = Partial<Omit<HiringPlanRole, 'id' | 'updatedBy' | 'updatedAt'>>

export interface HiringPlanDeps {
  getAll(): Promise<HiringPlanRole[]>
  get(id: string): Promise<HiringPlanRole | null>
  insert(patch: HiringPlanPatch, actor: string, at: string): Promise<HiringPlanRole>
  update(id: string, patch: HiringPlanPatch, actor: string, at: string): Promise<void>
  remove(id: string): Promise<void>
  addChange(id: string, before: unknown, after: unknown, actor: string, at: string): Promise<void>
  moveToReality(planId: string, actor: string): Promise<string> // returns new reality id (atomic in DB)
}

function fromRow(r: Record<string, unknown>): HiringPlanRole {
  return { id: r.id as string, department: r.department as HiringPlanRole['department'], role: r.role as string, headcount: Number(r.headcount ?? 1), plannedStartDate: (r.planned_start_date as string) ?? null, monthlySalaryCents: Number(r.monthly_salary_cents ?? 0), commissionCents: Number(r.commission_cents ?? 0), payrollBurdenPct: Number(r.payroll_burden_pct ?? 0), capacityModelId: (r.capacity_model_id as string) ?? null, hiringReason: (r.hiring_reason as string) ?? null, growthEngine: (r.growth_engine as string) ?? null, priority: (r.priority as HiringPlanRole['priority']) ?? null, status: r.status as HiringPlanRole['status'], notes: (r.notes as string) ?? null, updatedBy: (r.updated_by as string) ?? null, updatedAt: (r.updated_at as string) ?? null }
}
function toRow(p: HiringPlanPatch): Record<string, unknown> {
  const m: Record<string, unknown> = {}
  const map: Record<string, string> = { department: 'department', role: 'role', headcount: 'headcount', plannedStartDate: 'planned_start_date', monthlySalaryCents: 'monthly_salary_cents', commissionCents: 'commission_cents', payrollBurdenPct: 'payroll_burden_pct', capacityModelId: 'capacity_model_id', hiringReason: 'hiring_reason', growthEngine: 'growth_engine', priority: 'priority', status: 'status', notes: 'notes' }
  for (const [k, col] of Object.entries(map)) if (k in p) m[col] = (p as Record<string, unknown>)[k]
  return m
}

const dbDeps: HiringPlanDeps = {
  async getAll() {
    const { createAdminClient } = await import('@/lib/supabase/server')
    const { data } = await createAdminClient().from('cc_hiring_plan').select('*').order('planned_start_date', { nullsFirst: false })
    return ((data as Array<Record<string, unknown>> | null) ?? []).map(fromRow)
  },
  async get(id) {
    const { createAdminClient } = await import('@/lib/supabase/server')
    const { data } = await createAdminClient().from('cc_hiring_plan').select('*').eq('id', id).maybeSingle()
    return data ? fromRow(data as Record<string, unknown>) : null
  },
  async insert(patch, actor, at) {
    const { createAdminClient } = await import('@/lib/supabase/server')
    const { data } = await createAdminClient().from('cc_hiring_plan').insert({ ...toRow(patch), updated_by: actor, updated_at: at }).select('*').single()
    return fromRow(data as Record<string, unknown>)
  },
  async update(id, patch, actor, at) {
    const { createAdminClient } = await import('@/lib/supabase/server')
    await createAdminClient().from('cc_hiring_plan').update({ ...toRow(patch), updated_by: actor, updated_at: at }).eq('id', id)
  },
  async remove(id) {
    const { createAdminClient } = await import('@/lib/supabase/server')
    await createAdminClient().from('cc_hiring_plan').delete().eq('id', id)
  },
  async addChange(id, before, after, actor, at) {
    const { createAdminClient } = await import('@/lib/supabase/server')
    await createAdminClient().from('cc_change_log').insert({ entity_type: 'hiring_plan', entity_id: id, changed_by: actor, changed_at: at, before_json: before, after_json: after })
  },
  async moveToReality(planId, actor) {
    const { createAdminClient } = await import('@/lib/supabase/server')
    const { data, error } = await createAdminClient().rpc('cc_move_hire_to_reality', { p_plan_id: planId, p_actor: actor })
    if (error) throw new Error(error.message)
    return data as string
  },
}
let deps: HiringPlanDeps = dbDeps
export function __setHiringPlanDepsForTests(d: HiringPlanDeps | null) { deps = d ?? dbDeps }

export const getHiringPlan = (): Promise<HiringPlanRole[]> => deps.getAll()

export async function saveHiringPlan(id: string | null, patch: HiringPlanPatch, actor: string): Promise<HiringPlanRole> {
  const at = new Date().toISOString()
  if (!id) {
    const created = await deps.insert(patch, actor, at)
    await deps.addChange(created.id, null, created, actor, at)
    return created
  }
  const before = await deps.get(id)
  await deps.update(id, patch, actor, at)
  const after = { ...(before ?? {}), ...patch, updatedBy: actor, updatedAt: at }
  await deps.addChange(id, before, after, actor, at)
  return after as HiringPlanRole
}
export async function deleteHiringPlan(id: string, actor: string): Promise<void> {
  const at = new Date().toISOString()
  const before = await deps.get(id)
  if (!before) return
  await deps.remove(id)
  await deps.addChange(id, before, null, actor, at)
}
// Explicit founder action — atomic in the DB (function). Returns the new reality row id.
export const moveHireToReality = (planId: string, actor: string): Promise<string> => deps.moveToReality(planId, actor)
