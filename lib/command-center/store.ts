import { flattenDefaults, resolveAssumptions, defaultValue, type AssumptionRow } from './resolve'
import { ASSUMPTION_REGISTRY } from './schema'
import type { CommandCenterAssumptions } from './types'

// Persistence repository for the CEO Command Center assumptions. Every mutation is AUDITED (who/when/
// before/after in cc_change_log) and NEVER loses history; resets and rollbacks are themselves audited
// changes. DB access is behind an injectable `deps` seam so the audit/version/rollback logic is fully
// unit-testable with no database. One current row per (config, category, key); the change log is the
// version history. Financial math lives in the engine — this layer only stores/resolves values.

const CC_EFFECTIVE = '1970-01-01' // single "current" effective row per key; versioning lives in the change log

export interface ConfigMeta { id: string; name: string; scenarioType: string; updatedAt: string; updatedBy: string | null }
export interface StoredRow { category: string; key: string; numeric_value: number; updated_at: string; updated_by: string | null }
export interface ChangeEntry { id: string; configId: string; key: string; before: number | null; after: number | null; changedBy: string; changedAt: string }
export interface Change { category: string; key: string; value: number }
export interface AppliedChange { key: string; before: number | null; after: number }

export interface StoreDeps {
  getActiveConfig(): Promise<ConfigMeta | null>
  createConfig(input: { name: string; scenarioType: string; createdBy: string }): Promise<ConfigMeta>
  seedRows(configId: string, rows: AssumptionRow[], actor: string, at: string): Promise<void>
  getRows(configId: string): Promise<StoredRow[]>
  putRow(configId: string, row: { category: string; key: string; value: number; actor: string; at: string }): Promise<void>
  addChange(configId: string, e: { key: string; before: number | null; after: number; actor: string; at: string }): Promise<void>
  getChanges(configId: string, limit: number): Promise<ChangeEntry[]>
  getChangeById(id: string): Promise<ChangeEntry | null>
  touchConfig(configId: string, actor: string, at: string): Promise<void>
}

const now = () => new Date().toISOString()

// ── DB-backed deps (lazy imports; unit tests never load Supabase) ────────────────────────────────────
const dbDeps: StoreDeps = {
  async getActiveConfig() {
    const { createAdminClient } = await import('@/lib/supabase/server')
    const { data } = await createAdminClient().from('cc_configs')
      .select('id, name, scenario_type, updated_at, updated_by:created_by').eq('is_active', true)
      .order('updated_at', { ascending: false }).limit(1).maybeSingle()
    return data ? { id: data.id, name: data.name, scenarioType: data.scenario_type, updatedAt: data.updated_at, updatedBy: (data as { updated_by?: string | null }).updated_by ?? null } : null
  },
  async createConfig({ name, scenarioType, createdBy }) {
    const { createAdminClient } = await import('@/lib/supabase/server')
    const { data, error } = await createAdminClient().from('cc_configs')
      .insert({ name, scenario_type: scenarioType, is_active: true, created_by: createdBy }).select('id, name, scenario_type, updated_at').single()
    if (error) throw new Error(`createConfig: ${error.message}`)
    return { id: data.id, name: data.name, scenarioType: data.scenario_type, updatedAt: data.updated_at, updatedBy: createdBy }
  },
  async seedRows(configId, rows, actor, at) {
    const { createAdminClient } = await import('@/lib/supabase/server')
    await createAdminClient().from('cc_assumptions').insert(
      rows.map((r) => ({ config_id: configId, category: r.category, key: r.key, numeric_value: r.numeric_value, effective_from: CC_EFFECTIVE, source: 'default', updated_at: at })),
    )
  },
  async getRows(configId) {
    const { createAdminClient } = await import('@/lib/supabase/server')
    const { data } = await createAdminClient().from('cc_assumptions')
      .select('category, key, numeric_value, updated_at').eq('config_id', configId).eq('effective_from', CC_EFFECTIVE)
    return (data as Array<{ category: string; key: string; numeric_value: number; updated_at: string }> | null)?.map((r) => ({ ...r, updated_by: null })) ?? []
  },
  async putRow(configId, { category, key, value, at }) {
    const { createAdminClient } = await import('@/lib/supabase/server')
    await createAdminClient().from('cc_assumptions')
      .upsert({ config_id: configId, category, key, numeric_value: value, effective_from: CC_EFFECTIVE, updated_at: at }, { onConflict: 'config_id,category,key,effective_from' })
  },
  async addChange(configId, { key, before, after, actor, at }) {
    const { createAdminClient } = await import('@/lib/supabase/server')
    await createAdminClient().from('cc_change_log').insert({ entity_type: 'assumption', entity_id: configId, changed_by: actor, changed_at: at, before_json: { key, value: before }, after_json: { key, value: after } })
  },
  async getChanges(configId, limit) {
    const { createAdminClient } = await import('@/lib/supabase/server')
    const { data } = await createAdminClient().from('cc_change_log')
      .select('id, entity_id, changed_by, changed_at, before_json, after_json').eq('entity_type', 'assumption').eq('entity_id', configId)
      .order('changed_at', { ascending: false }).limit(limit)
    return ((data as Array<{ id: string; entity_id: string; changed_by: string; changed_at: string; before_json: { key: string; value: number | null }; after_json: { key: string; value: number | null } }> | null) ?? [])
      .map((c) => ({ id: c.id, configId: c.entity_id, key: c.after_json?.key ?? c.before_json?.key, before: c.before_json?.value ?? null, after: c.after_json?.value ?? null, changedBy: c.changed_by, changedAt: c.changed_at }))
  },
  async getChangeById(id) {
    const { createAdminClient } = await import('@/lib/supabase/server')
    const { data } = await createAdminClient().from('cc_change_log').select('id, entity_id, changed_by, changed_at, before_json, after_json').eq('id', id).maybeSingle()
    if (!data) return null
    const c = data as { id: string; entity_id: string; changed_by: string; changed_at: string; before_json: { key: string; value: number | null }; after_json: { key: string; value: number | null } }
    return { id: c.id, configId: c.entity_id, key: c.after_json?.key ?? c.before_json?.key, before: c.before_json?.value ?? null, after: c.after_json?.value ?? null, changedBy: c.changed_by, changedAt: c.changed_at }
  },
  async touchConfig(configId, actor, at) {
    const { createAdminClient } = await import('@/lib/supabase/server')
    await createAdminClient().from('cc_configs').update({ updated_at: at, created_by: actor }).eq('id', configId)
  },
}

let deps: StoreDeps = dbDeps
export function __setStoreDepsForTests(d: StoreDeps | null) { deps = d ?? dbDeps }

// Ensure a Base config exists (seeded from defaults) and return the active one. Concurrency-safe: a
// `single-active` unique index (migration #2) makes a racing second create fail; we then return the winner.
// A partially-seeded config still resolves correctly because resolveAssumptions falls back to defaults for
// any not-yet-written key.
export async function getOrCreateBaseConfig(actor: string): Promise<ConfigMeta> {
  const active = await deps.getActiveConfig()
  if (active) return active
  try {
    const cfg = await deps.createConfig({ name: 'Base', scenarioType: 'base', createdBy: actor })
    await deps.seedRows(cfg.id, flattenDefaults(), actor, now())
    return cfg
  } catch (e) {
    const raced = await deps.getActiveConfig() // lost the race → the other request's config is now active
    if (raced) return raced
    throw e
  }
}

export async function getResolvedAssumptions(configId: string): Promise<CommandCenterAssumptions> {
  const rows = await deps.getRows(configId)
  return resolveAssumptions(rows.map((r) => ({ category: r.category, key: r.key, numeric_value: r.numeric_value })))
}

// Apply changes; audit only real changes (no-ops are skipped). Returns what was applied.
export async function saveChanges(configId: string, changes: Change[], actor: string): Promise<AppliedChange[]> {
  const rows = await deps.getRows(configId)
  const current = new Map(rows.map((r) => [`${r.category}.${r.key}`, r.numeric_value]))
  const at = now()
  const applied: AppliedChange[] = []
  for (const c of changes) {
    const id = `${c.category}.${c.key}`
    const before = current.has(id) ? current.get(id)! : (defaultValue(c.category, c.key) ?? null)
    if (before === c.value) continue
    await deps.putRow(configId, { category: c.category, key: c.key, value: c.value, actor, at })
    await deps.addChange(configId, { key: id, before, after: c.value, actor, at })
    applied.push({ key: id, before, after: c.value })
  }
  if (applied.length) await deps.touchConfig(configId, actor, at)
  return applied
}

export async function resetSection(configId: string, section: string, actor: string): Promise<AppliedChange[]> {
  const changes = ASSUMPTION_REGISTRY.filter((d) => d.section === section).map((d) => ({ category: d.category, key: d.key, value: defaultValue(d.category, d.key)! }))
  return saveChanges(configId, changes, actor)
}
export async function resetAll(configId: string, actor: string): Promise<AppliedChange[]> {
  const changes = ASSUMPTION_REGISTRY.map((d) => ({ category: d.category, key: d.key, value: defaultValue(d.category, d.key)! }))
  return saveChanges(configId, changes, actor)
}

export async function getHistory(configId: string, limit = 100): Promise<ChangeEntry[]> {
  return deps.getChanges(configId, limit)
}

// Rollback: revert a specific logged change to its BEFORE value (itself audited as a new change).
export async function revertChange(configId: string, changeId: string, actor: string): Promise<AppliedChange[]> {
  const ch = await deps.getChangeById(changeId)
  if (!ch || ch.configId !== configId || ch.before === null || !ch.key) return []
  const [category, key] = ch.key.split('.')
  return saveChanges(configId, [{ category, key, value: ch.before }], actor)
}
