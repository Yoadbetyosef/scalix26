import { BASE_ASSUMPTIONS } from './defaults'
import { ASSUMPTION_REGISTRY, REGISTRY_BY_ID } from './schema'
import type { CommandCenterAssumptions } from './types'

// Bridge between persisted assumption rows (category/key/numeric_value) and the typed object the engine
// consumes. Missing rows fall back to the Base defaults, so a partially-seeded config always resolves to a
// complete, valid assumption set. Round-trip safe: resolve(flattenDefaults()) === BASE_ASSUMPTIONS.

export interface AssumptionRow { category: string; key: string; numeric_value: number }

function getPath(obj: CommandCenterAssumptions, path: string): number {
  return path.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], obj) as number
}
function setPath(obj: CommandCenterAssumptions, path: string, val: number): void {
  const ks = path.split('.')
  let o = obj as unknown as Record<string, unknown>
  for (let i = 0; i < ks.length - 1; i++) o = o[ks[i]] as Record<string, unknown>
  o[ks[ks.length - 1]] = val
}

export function flatten(a: CommandCenterAssumptions): AssumptionRow[] {
  return ASSUMPTION_REGISTRY.map((d) => ({ category: d.category, key: d.key, numeric_value: getPath(a, d.path) }))
}
export function flattenDefaults(): AssumptionRow[] {
  return flatten(BASE_ASSUMPTIONS)
}

export function resolveAssumptions(rows: AssumptionRow[]): CommandCenterAssumptions {
  const a = structuredClone(BASE_ASSUMPTIONS)
  for (const r of rows) {
    const def = REGISTRY_BY_ID[`${r.category}.${r.key}`]
    if (!def) continue // unknown row → ignore (forward-compatible)
    if (typeof r.numeric_value === 'number' && Number.isFinite(r.numeric_value)) setPath(a, def.path, r.numeric_value)
  }
  return a
}

// Default value for a single assumption (for "reset section" / "reset all").
export function defaultValue(category: string, key: string): number | undefined {
  const def = REGISTRY_BY_ID[`${category}.${key}`]
  return def ? getPath(BASE_ASSUMPTIONS, def.path) : undefined
}
