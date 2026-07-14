import type { CostItem } from './costs'

// Actual/manual cost store (cc_actual_costs). Founder-gated CRUD, audited before/after.
export type CostPatch = Partial<Omit<CostItem, 'id' | 'updatedBy' | 'updatedAt'>>

export interface CostDeps {
  getAll(): Promise<CostItem[]>
  get(id: string): Promise<CostItem | null>
  insert(patch: CostPatch, actor: string, at: string): Promise<CostItem>
  update(id: string, patch: CostPatch, actor: string, at: string): Promise<void>
  remove(id: string): Promise<void>
  addChange(id: string, before: unknown, after: unknown, actor: string, at: string): Promise<void>
}

function fromRow(r: Record<string, unknown>): CostItem {
  return { id: r.id as string, costType: r.cost_type as CostItem['costType'], category: r.category as string, vendor: (r.vendor as string) ?? null, amountCents: Number(r.amount_cents ?? 0), recurrence: r.recurrence as CostItem['recurrence'], startDate: r.start_date as string, endDate: (r.end_date as string) ?? null, notes: (r.notes as string) ?? null, owner: (r.owner as string) ?? null, sourceClassification: (r.source_classification as string) ?? 'manual', updatedBy: (r.updated_by as string) ?? null, updatedAt: (r.updated_at as string) ?? null }
}
function toRow(p: CostPatch): Record<string, unknown> {
  const m: Record<string, unknown> = {}
  const map: Record<string, string> = { costType: 'cost_type', category: 'category', vendor: 'vendor', amountCents: 'amount_cents', recurrence: 'recurrence', startDate: 'start_date', endDate: 'end_date', notes: 'notes', owner: 'owner', sourceClassification: 'source_classification' }
  for (const [k, col] of Object.entries(map)) if (k in p) m[col] = (p as Record<string, unknown>)[k]
  return m
}

const dbDeps: CostDeps = {
  async getAll() {
    const { createAdminClient } = await import('@/lib/supabase/server')
    const { data } = await createAdminClient().from('cc_actual_costs').select('*').order('amount_cents', { ascending: false })
    return ((data as Array<Record<string, unknown>> | null) ?? []).map(fromRow)
  },
  async get(id) {
    const { createAdminClient } = await import('@/lib/supabase/server')
    const { data } = await createAdminClient().from('cc_actual_costs').select('*').eq('id', id).maybeSingle()
    return data ? fromRow(data as Record<string, unknown>) : null
  },
  async insert(patch, actor, at) {
    const { createAdminClient } = await import('@/lib/supabase/server')
    const { data, error } = await createAdminClient().from('cc_actual_costs').insert({ ...toRow(patch), updated_by: actor, updated_at: at }).select('*').single()
    if (error) throw new Error(error.message)
    return fromRow(data as Record<string, unknown>)
  },
  async update(id, patch, actor, at) {
    const { createAdminClient } = await import('@/lib/supabase/server')
    await createAdminClient().from('cc_actual_costs').update({ ...toRow(patch), updated_by: actor, updated_at: at }).eq('id', id)
  },
  async remove(id) {
    const { createAdminClient } = await import('@/lib/supabase/server')
    await createAdminClient().from('cc_actual_costs').delete().eq('id', id)
  },
  async addChange(id, before, after, actor, at) {
    const { createAdminClient } = await import('@/lib/supabase/server')
    await createAdminClient().from('cc_change_log').insert({ entity_type: 'actual_cost', entity_id: id, changed_by: actor, changed_at: at, before_json: before, after_json: after })
  },
}
let deps: CostDeps = dbDeps
export function __setCostDepsForTests(d: CostDeps | null) { deps = d ?? dbDeps }

export const getCostItems = (): Promise<CostItem[]> => deps.getAll()

export async function saveCost(id: string | null, patch: CostPatch, actor: string): Promise<CostItem> {
  const at = new Date().toISOString()
  if (!id) { const created = await deps.insert(patch, actor, at); await deps.addChange(created.id, null, created, actor, at); return created }
  const before = await deps.get(id)
  await deps.update(id, patch, actor, at)
  const after = { ...(before ?? {}), ...patch, updatedBy: actor, updatedAt: at }
  await deps.addChange(id, before, after, actor, at)
  return after as CostItem
}
export async function deleteCost(id: string, actor: string): Promise<void> {
  const at = new Date().toISOString()
  const before = await deps.get(id)
  if (!before) return
  await deps.remove(id)
  await deps.addChange(id, before, null, actor, at)
}
