import { type TeamRole } from './capacity-v2'

// Persistence + audit for the live team roster (cc_team_roles). Founder-editable; every mutation audited
// before/after to cc_change_log. DB access behind an injectable seam for unit tests.

export type TeamRolePatch = Partial<Omit<TeamRole, 'id' | 'updatedBy' | 'updatedAt'>>

export interface TeamStoreDeps {
  getAll(): Promise<TeamRole[]>
  get(id: string): Promise<TeamRole | null>
  insert(patch: TeamRolePatch, actor: string, at: string): Promise<TeamRole>
  update(id: string, patch: TeamRolePatch, actor: string, at: string): Promise<void>
  remove(id: string): Promise<void>
  addChange(id: string, before: unknown, after: unknown, actor: string, at: string): Promise<void>
}

function fromRow(r: Record<string, unknown>): TeamRole {
  return {
    id: r.id as string, department: r.department as TeamRole['department'], role: r.role as string,
    currentHeadcount: Number(r.current_headcount ?? 0), plannedHeadcount: Number(r.planned_headcount ?? 0),
    monthlySalaryCents: Number(r.monthly_salary_cents ?? 0), commissionCents: Number(r.commission_cents ?? 0), payrollBurdenPct: Number(r.payroll_burden_pct ?? 0),
    startDate: (r.start_date as string) ?? null, capacityDriver: r.capacity_driver as TeamRole['capacityDriver'],
    capacityPerEmployee: Number(r.capacity_per_employee ?? 0), targetUtilization: Number(r.target_utilization ?? 0.8),
    notes: (r.notes as string) ?? null, updatedBy: (r.updated_by as string) ?? null, updatedAt: (r.updated_at as string) ?? null,
  }
}
function toRow(p: TeamRolePatch): Record<string, unknown> {
  const m: Record<string, unknown> = {}
  const map: Record<string, string> = { department: 'department', role: 'role', currentHeadcount: 'current_headcount', plannedHeadcount: 'planned_headcount', monthlySalaryCents: 'monthly_salary_cents', commissionCents: 'commission_cents', payrollBurdenPct: 'payroll_burden_pct', startDate: 'start_date', capacityDriver: 'capacity_driver', capacityPerEmployee: 'capacity_per_employee', targetUtilization: 'target_utilization', notes: 'notes' }
  for (const [k, col] of Object.entries(map)) if (k in p) m[col] = (p as Record<string, unknown>)[k]
  return m
}

const dbDeps: TeamStoreDeps = {
  async getAll() {
    const { createAdminClient } = await import('@/lib/supabase/server')
    const { data } = await createAdminClient().from('cc_team_roles').select('*').order('department')
    return ((data as Array<Record<string, unknown>> | null) ?? []).map(fromRow)
  },
  async get(id) {
    const { createAdminClient } = await import('@/lib/supabase/server')
    const { data } = await createAdminClient().from('cc_team_roles').select('*').eq('id', id).maybeSingle()
    return data ? fromRow(data as Record<string, unknown>) : null
  },
  async insert(patch, actor, at) {
    const { createAdminClient } = await import('@/lib/supabase/server')
    const { data } = await createAdminClient().from('cc_team_roles').insert({ ...toRow(patch), updated_by: actor, updated_at: at }).select('*').single()
    return fromRow(data as Record<string, unknown>)
  },
  async update(id, patch, actor, at) {
    const { createAdminClient } = await import('@/lib/supabase/server')
    await createAdminClient().from('cc_team_roles').update({ ...toRow(patch), updated_by: actor, updated_at: at }).eq('id', id)
  },
  async remove(id) {
    const { createAdminClient } = await import('@/lib/supabase/server')
    await createAdminClient().from('cc_team_roles').delete().eq('id', id)
  },
  async addChange(id, before, after, actor, at) {
    const { createAdminClient } = await import('@/lib/supabase/server')
    await createAdminClient().from('cc_change_log').insert({ entity_type: 'team_role', entity_id: id, changed_by: actor, changed_at: at, before_json: before, after_json: after })
  },
}
let deps: TeamStoreDeps = dbDeps
export function __setTeamStoreDepsForTests(d: TeamStoreDeps | null) { deps = d ?? dbDeps }

export const getTeamRoles = (): Promise<TeamRole[]> => deps.getAll()

export async function saveTeamRole(id: string | null, patch: TeamRolePatch, actor: string): Promise<TeamRole> {
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
  return after as TeamRole
}
export async function deleteTeamRole(id: string, actor: string): Promise<void> {
  const at = new Date().toISOString()
  const before = await deps.get(id)
  if (!before) return
  await deps.remove(id)
  await deps.addChange(id, before, null, actor, at)
}
