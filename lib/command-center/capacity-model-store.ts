import type { CapacityModel } from './capacity-v2'

// CONFIG store for capacity assumptions. Versioned by effective dates: an edit CLOSES the prior active row
// (status inactive, effective_to = today) and INSERTS a new active row — never a silent overwrite. Audited.

export type CapacityModelPatch = Partial<Omit<CapacityModel, 'id' | 'effectiveFrom' | 'effectiveTo' | 'status' | 'updatedBy' | 'updatedAt'>>

export interface CapacityModelDeps {
  getActive(): Promise<CapacityModel[]>
  get(id: string): Promise<CapacityModel | null>
  close(id: string, at: string): Promise<void>
  insert(m: Omit<CapacityModel, 'id' | 'updatedBy' | 'updatedAt'>, actor: string, at: string): Promise<CapacityModel>
  addChange(id: string, before: unknown, after: unknown, actor: string, at: string): Promise<void>
}

function fromRow(r: Record<string, unknown>): CapacityModel {
  return { id: r.id as string, roleKey: r.role_key as string, label: r.label as string, capacityDriver: r.capacity_driver as CapacityModel['capacityDriver'], capacityPerEmployee: Number(r.capacity_per_employee ?? 0), capacityUnit: (r.capacity_unit as string) ?? 'units', capacityPeriod: r.capacity_period as CapacityModel['capacityPeriod'], demandMetricKey: (r.demand_metric_key as string) ?? null, targetUtilization: Number(r.target_utilization ?? 0.8), sourceClassification: (r.source_classification as string) ?? 'manual', effectiveFrom: r.effective_from as string, effectiveTo: (r.effective_to as string) ?? null, status: r.status as 'active' | 'inactive', notes: (r.notes as string) ?? null, updatedBy: (r.updated_by as string) ?? null, updatedAt: (r.updated_at as string) ?? null }
}
const today = () => new Date().toISOString().slice(0, 10)

const dbDeps: CapacityModelDeps = {
  async getActive() {
    const { createAdminClient } = await import('@/lib/supabase/server')
    const t = today()
    const { data } = await createAdminClient().from('cc_capacity_model').select('*').eq('status', 'active').lte('effective_from', t).or(`effective_to.is.null,effective_to.gte.${t}`)
    return ((data as Array<Record<string, unknown>> | null) ?? []).map(fromRow)
  },
  async get(id) {
    const { createAdminClient } = await import('@/lib/supabase/server')
    const { data } = await createAdminClient().from('cc_capacity_model').select('*').eq('id', id).maybeSingle()
    return data ? fromRow(data as Record<string, unknown>) : null
  },
  async close(id, at) {
    const { createAdminClient } = await import('@/lib/supabase/server')
    await createAdminClient().from('cc_capacity_model').update({ status: 'inactive', effective_to: at.slice(0, 10) }).eq('id', id)
  },
  async insert(m, actor, at) {
    const { createAdminClient } = await import('@/lib/supabase/server')
    const { data } = await createAdminClient().from('cc_capacity_model').insert({ role_key: m.roleKey, label: m.label, capacity_driver: m.capacityDriver, capacity_per_employee: m.capacityPerEmployee, capacity_unit: m.capacityUnit, capacity_period: m.capacityPeriod, demand_metric_key: m.demandMetricKey, target_utilization: m.targetUtilization, source_classification: m.sourceClassification, effective_from: at.slice(0, 10), status: 'active', notes: m.notes, updated_by: actor, updated_at: at }).select('*').single()
    return fromRow(data as Record<string, unknown>)
  },
  async addChange(id, before, after, actor, at) {
    const { createAdminClient } = await import('@/lib/supabase/server')
    await createAdminClient().from('cc_change_log').insert({ entity_type: 'capacity_model', entity_id: id, changed_by: actor, changed_at: at, before_json: before, after_json: after })
  },
}
let deps: CapacityModelDeps = dbDeps
export function __setCapacityModelDepsForTests(d: CapacityModelDeps | null) { deps = d ?? dbDeps }

export const getCapacityModels = (): Promise<CapacityModel[]> => deps.getActive()

// Edit (id given) versions the model; create (no id) inserts a new active model for a new role_key.
export async function saveCapacityModel(id: string | null, patch: CapacityModelPatch, actor: string): Promise<CapacityModel> {
  const at = new Date().toISOString()
  if (id) {
    const before = await deps.get(id)
    if (!before) throw new Error('capacity model not found')
    await deps.close(id, at)
    const merged = { ...before, ...patch }
    const created = await deps.insert({ roleKey: merged.roleKey, label: merged.label, capacityDriver: merged.capacityDriver, capacityPerEmployee: merged.capacityPerEmployee, capacityUnit: merged.capacityUnit, capacityPeriod: merged.capacityPeriod, demandMetricKey: merged.demandMetricKey, targetUtilization: merged.targetUtilization, sourceClassification: merged.sourceClassification, effectiveFrom: at.slice(0, 10), effectiveTo: null, status: 'active', notes: merged.notes }, actor, at)
    await deps.addChange(created.id, before, created, actor, at)
    return created
  }
  const created = await deps.insert({ roleKey: patch.roleKey ?? '', label: patch.label ?? '', capacityDriver: patch.capacityDriver ?? 'manual', capacityPerEmployee: patch.capacityPerEmployee ?? 0, capacityUnit: patch.capacityUnit ?? 'units', capacityPeriod: patch.capacityPeriod ?? 'week', demandMetricKey: patch.demandMetricKey ?? null, targetUtilization: patch.targetUtilization ?? 0.8, sourceClassification: patch.sourceClassification ?? 'manual', effectiveFrom: at.slice(0, 10), effectiveTo: null, status: 'active', notes: patch.notes ?? null }, actor, at)
  await deps.addChange(created.id, null, created, actor, at)
  return created
}
