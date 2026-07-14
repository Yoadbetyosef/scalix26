import type { TeamRealityRole } from './capacity-v2'

// REALITY store — current org, aggregated by role, versioned by effective dates. Current reality =
// status 'active' AND effective_from <= today AND (effective_to IS NULL OR effective_to >= today).
// Changes CLOSE the prior effective period (status inactive, effective_to = today) and INSERT a new active
// row — historical reality is preserved, never overwritten. Every mutation is audited before/after.

export type TeamRealityPatch = Partial<Omit<TeamRealityRole, 'id' | 'effectiveFrom' | 'effectiveTo' | 'status' | 'updatedBy' | 'updatedAt'>>

export interface TeamRealityDeps {
  getActive(): Promise<TeamRealityRole[]>
  get(id: string): Promise<TeamRealityRole | null>
  close(id: string, at: string): Promise<void>
  insert(r: Omit<TeamRealityRole, 'id' | 'effectiveFrom' | 'effectiveTo' | 'status' | 'updatedBy' | 'updatedAt'>, actor: string, at: string): Promise<TeamRealityRole>
  addChange(id: string, before: unknown, after: unknown, actor: string, at: string): Promise<void>
}

function fromRow(r: Record<string, unknown>): TeamRealityRole {
  return { id: r.id as string, department: r.department as TeamRealityRole['department'], role: r.role as string, currentHeadcount: Number(r.current_headcount ?? 0), monthlySalaryCents: Number(r.monthly_salary_cents ?? 0), commissionCents: Number(r.commission_cents ?? 0), payrollBurdenPct: Number(r.payroll_burden_pct ?? 0), capacityModelId: (r.capacity_model_id as string) ?? null, effectiveFrom: r.effective_from as string, effectiveTo: (r.effective_to as string) ?? null, status: r.status as 'active' | 'inactive', notes: (r.notes as string) ?? null, updatedBy: (r.updated_by as string) ?? null, updatedAt: (r.updated_at as string) ?? null }
}

const dbDeps: TeamRealityDeps = {
  async getActive() {
    const { createAdminClient } = await import('@/lib/supabase/server')
    const t = new Date().toISOString().slice(0, 10)
    const { data } = await createAdminClient().from('cc_team_reality').select('*').eq('status', 'active').lte('effective_from', t).or(`effective_to.is.null,effective_to.gte.${t}`).order('department')
    return ((data as Array<Record<string, unknown>> | null) ?? []).map(fromRow)
  },
  async get(id) {
    const { createAdminClient } = await import('@/lib/supabase/server')
    const { data } = await createAdminClient().from('cc_team_reality').select('*').eq('id', id).maybeSingle()
    return data ? fromRow(data as Record<string, unknown>) : null
  },
  async close(id, at) {
    const { createAdminClient } = await import('@/lib/supabase/server')
    await createAdminClient().from('cc_team_reality').update({ status: 'inactive', effective_to: at.slice(0, 10) }).eq('id', id)
  },
  async insert(r, actor, at) {
    const { createAdminClient } = await import('@/lib/supabase/server')
    const { data } = await createAdminClient().from('cc_team_reality').insert({ department: r.department, role: r.role, current_headcount: r.currentHeadcount, monthly_salary_cents: r.monthlySalaryCents, commission_cents: r.commissionCents, payroll_burden_pct: r.payrollBurdenPct, capacity_model_id: r.capacityModelId, effective_from: at.slice(0, 10), status: 'active', notes: r.notes, updated_by: actor, updated_at: at }).select('*').single()
    return fromRow(data as Record<string, unknown>)
  },
  async addChange(id, before, after, actor, at) {
    const { createAdminClient } = await import('@/lib/supabase/server')
    await createAdminClient().from('cc_change_log').insert({ entity_type: 'team_reality', entity_id: id, changed_by: actor, changed_at: at, before_json: before, after_json: after })
  },
}
let deps: TeamRealityDeps = dbDeps
export function __setTeamRealityDepsForTests(d: TeamRealityDeps | null) { deps = d ?? dbDeps }

export const getTeamReality = (): Promise<TeamRealityRole[]> => deps.getActive()

// Edit (id given) versions the role: closes the prior period, inserts a new active row. Create (no id) inserts.
export async function saveTeamRealityRole(id: string | null, patch: TeamRealityPatch, actor: string): Promise<TeamRealityRole> {
  const at = new Date().toISOString()
  if (id) {
    const before = await deps.get(id)
    if (!before) throw new Error('team reality role not found')
    await deps.close(id, at)
    const m = { ...before, ...patch }
    const created = await deps.insert({ department: m.department, role: m.role, currentHeadcount: m.currentHeadcount, monthlySalaryCents: m.monthlySalaryCents, commissionCents: m.commissionCents, payrollBurdenPct: m.payrollBurdenPct, capacityModelId: m.capacityModelId, notes: m.notes }, actor, at)
    await deps.addChange(created.id, before, created, actor, at)
    return created
  }
  const created = await deps.insert({ department: patch.department ?? 'operations', role: patch.role ?? '', currentHeadcount: patch.currentHeadcount ?? 0, monthlySalaryCents: patch.monthlySalaryCents ?? 0, commissionCents: patch.commissionCents ?? 0, payrollBurdenPct: patch.payrollBurdenPct ?? 0, capacityModelId: patch.capacityModelId ?? null, notes: patch.notes ?? null }, actor, at)
  await deps.addChange(created.id, null, created, actor, at)
  return created
}

// Soft close a role (no hard delete of history): close the effective period, mark inactive, audit.
export async function closeTeamRealityRole(id: string, actor: string): Promise<void> {
  const at = new Date().toISOString()
  const before = await deps.get(id)
  if (!before || before.status !== 'active') return
  await deps.close(id, at)
  await deps.addChange(id, before, { ...before, status: 'inactive', effectiveTo: at.slice(0, 10) }, actor, at)
}
