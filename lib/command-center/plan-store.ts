import type { PrimaryMetric } from './plan'
import type { EngineAllocation } from './plan-engines'

// Single active Plan (cc_plan): the founder's destination + editable engine allocation. The whole cascade is
// DERIVED from this + reality + assumptions and is never stored. Founder-gated writes are audited.

export interface PlanRow {
  id: string; primaryMetric: PrimaryMetric; annualTarget: number; startDate: string; targetDate: string | null
  arpuTargetCents: number | null; monthlyGoalOverride: number | null; allocation: EngineAllocation
  mode: 'simple' | 'advanced'; status: 'draft' | 'active'; updatedBy: string | null; updatedAt: string | null
}
export type PlanPatch = Partial<Omit<PlanRow, 'id' | 'updatedBy' | 'updatedAt'>>

export interface PlanStoreDeps {
  getActive(): Promise<PlanRow | null>
  upsert(id: string | null, patch: PlanPatch, actor: string, at: string): Promise<PlanRow>
  addChange(id: string, before: unknown, after: unknown, actor: string, at: string): Promise<void>
}

function fromRow(r: Record<string, unknown>): PlanRow {
  return { id: r.id as string, primaryMetric: r.primary_metric as PrimaryMetric, annualTarget: Number(r.annual_target ?? 0), startDate: r.start_date as string, targetDate: (r.target_date as string) ?? null, arpuTargetCents: r.arpu_target_cents == null ? null : Number(r.arpu_target_cents), monthlyGoalOverride: r.monthly_goal_override == null ? null : Number(r.monthly_goal_override), allocation: { direct: Number(r.alloc_direct ?? 0), affiliate: Number(r.alloc_affiliate ?? 0), whiteLabel: Number(r.alloc_whitelabel ?? 0), expansion: Number(r.alloc_expansion ?? 0) }, mode: r.mode as 'simple' | 'advanced', status: r.status as 'draft' | 'active', updatedBy: (r.updated_by as string) ?? null, updatedAt: (r.updated_at as string) ?? null }
}
function toRow(p: PlanPatch): Record<string, unknown> {
  const m: Record<string, unknown> = {}
  if ('primaryMetric' in p) m.primary_metric = p.primaryMetric
  if ('annualTarget' in p) m.annual_target = p.annualTarget
  if ('startDate' in p) m.start_date = p.startDate
  if ('targetDate' in p) m.target_date = p.targetDate
  if ('arpuTargetCents' in p) m.arpu_target_cents = p.arpuTargetCents
  if ('monthlyGoalOverride' in p) m.monthly_goal_override = p.monthlyGoalOverride
  if ('mode' in p) m.mode = p.mode
  if ('status' in p) m.status = p.status
  if (p.allocation) { m.alloc_direct = p.allocation.direct; m.alloc_affiliate = p.allocation.affiliate; m.alloc_whitelabel = p.allocation.whiteLabel; m.alloc_expansion = p.allocation.expansion }
  return m
}

const dbDeps: PlanStoreDeps = {
  async getActive() {
    const { createAdminClient } = await import('@/lib/supabase/server')
    const { data } = await createAdminClient().from('cc_plan').select('*').eq('is_active', true).maybeSingle()
    return data ? fromRow(data as Record<string, unknown>) : null
  },
  async upsert(id, patch, actor, at) {
    const { createAdminClient } = await import('@/lib/supabase/server')
    const db = createAdminClient()
    if (id) {
      const { data } = await db.from('cc_plan').update({ ...toRow(patch), updated_by: actor, updated_at: at }).eq('id', id).select('*').single()
      return fromRow(data as Record<string, unknown>)
    }
    const { data, error } = await db.from('cc_plan').insert({ ...toRow(patch), is_active: true, updated_by: actor, updated_at: at }).select('*').single()
    if (error) throw new Error(error.message)
    return fromRow(data as Record<string, unknown>)
  },
  async addChange(id, before, after, actor, at) {
    const { createAdminClient } = await import('@/lib/supabase/server')
    await createAdminClient().from('cc_change_log').insert({ entity_type: 'plan', entity_id: id, changed_by: actor, changed_at: at, before_json: before, after_json: after })
  },
}
let deps: PlanStoreDeps = dbDeps
export function __setPlanStoreDepsForTests(d: PlanStoreDeps | null) { deps = d ?? dbDeps }

export const getActivePlan = (): Promise<PlanRow | null> => deps.getActive()

export async function savePlan(patch: PlanPatch, actor: string): Promise<PlanRow> {
  const at = new Date().toISOString()
  const before = await deps.getActive()
  const after = await deps.upsert(before?.id ?? null, patch, actor, at)
  await deps.addChange(after.id, before, after, actor, at)
  return after
}
