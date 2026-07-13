import { describe, it, expect, afterEach } from 'vitest'
import {
  __setStoreDepsForTests, getOrCreateBaseConfig, getResolvedAssumptions, saveChanges,
  resetSection, resetAll, getHistory, revertChange,
  type StoreDeps, type ConfigMeta, type StoredRow, type ChangeEntry,
} from './store'
import { BASE_ASSUMPTIONS } from './defaults'
import { ASSUMPTION_REGISTRY } from './schema'
import { toCents } from './money'

afterEach(() => __setStoreDepsForTests(null))

function fakeStore() {
  let cfg: ConfigMeta | null = null
  const rows = new Map<string, StoredRow>()
  const changes: ChangeEntry[] = []
  let seq = 0
  const d: StoreDeps = {
    getActiveConfig: async () => cfg,
    createConfig: async ({ name, scenarioType, createdBy }) => { cfg = { id: 'cfg1', name, scenarioType, updatedAt: 't0', updatedBy: createdBy }; return cfg },
    seedRows: async (_id, rs, actor, at) => { for (const r of rs) rows.set(`${r.category}.${r.key}`, { category: r.category, key: r.key, numeric_value: r.numeric_value, updated_at: at, updated_by: actor }) },
    getRows: async () => [...rows.values()],
    putRow: async (_id, { category, key, value, actor, at }) => { rows.set(`${category}.${key}`, { category, key, numeric_value: value, updated_at: at, updated_by: actor }) },
    addChange: async (configId, { key, before, after, actor, at }) => { changes.unshift({ id: `c${++seq}`, configId, key, before, after, changedBy: actor, changedAt: at }) },
    getChanges: async (_id, limit) => changes.slice(0, limit),
    getChangeById: async (id) => changes.find((c) => c.id === id) ?? null,
    touchConfig: async (_id, actor, at) => { if (cfg) cfg = { ...cfg, updatedAt: at, updatedBy: actor } },
  }
  __setStoreDepsForTests(d)
  return { rows, changes }
}

describe('assumption persistence (audit / version / rollback)', () => {
  it('seeds a Base config with every registered assumption; resolves to defaults', async () => {
    const s = fakeStore()
    const cfg = await getOrCreateBaseConfig('founder@x')
    expect(s.rows.size).toBe(ASSUMPTION_REGISTRY.length)
    expect(await getResolvedAssumptions(cfg.id)).toEqual(BASE_ASSUMPTIONS)
  })

  it('saves an edit, audits before/after, and survives re-read', async () => {
    fakeStore()
    const cfg = await getOrCreateBaseConfig('founder@x')
    const applied = await saveChanges(cfg.id, [{ category: 'pricing', key: 'starterCents', value: toCents(349) }], 'founder@x')
    expect(applied).toEqual([{ key: 'pricing.starterCents', before: toCents(297), after: toCents(349) }])
    expect((await getResolvedAssumptions(cfg.id)).pricing.starterCents).toBe(toCents(349))
    const hist = await getHistory(cfg.id)
    expect(hist[0]).toMatchObject({ key: 'pricing.starterCents', before: toCents(297), after: toCents(349), changedBy: 'founder@x' })
  })

  it('no-op edits are not audited', async () => {
    fakeStore()
    const cfg = await getOrCreateBaseConfig('f')
    const applied = await saveChanges(cfg.id, [{ category: 'pricing', key: 'starterCents', value: toCents(297) }], 'f')
    expect(applied).toEqual([])
    expect(await getHistory(cfg.id)).toHaveLength(0)
  })

  it('reset section reverts only that section to defaults (audited)', async () => {
    fakeStore()
    const cfg = await getOrCreateBaseConfig('f')
    await saveChanges(cfg.id, [{ category: 'pricing', key: 'starterCents', value: toCents(349) }, { category: 'retention', key: 'monthlyLogoChurn', value: 0.05 }], 'f')
    await resetSection(cfg.id, 'Product Pricing', 'f')
    const r = await getResolvedAssumptions(cfg.id)
    expect(r.pricing.starterCents).toBe(toCents(297)) // reset
    expect(r.retention.monthlyLogoChurn).toBe(0.05) // untouched
  })

  it('reset all returns every assumption to defaults', async () => {
    fakeStore()
    const cfg = await getOrCreateBaseConfig('f')
    await saveChanges(cfg.id, [{ category: 'valuation', key: 'arrMultiple', value: 15 }], 'f')
    await resetAll(cfg.id, 'f')
    expect(await getResolvedAssumptions(cfg.id)).toEqual(BASE_ASSUMPTIONS)
  })

  it('concurrency: losing the create race returns the winning active config (no duplicate)', async () => {
    let created = false
    const winner: ConfigMeta = { id: 'winner', name: 'Base', scenarioType: 'base', updatedAt: 't', updatedBy: 'other' }
    __setStoreDepsForTests({
      getActiveConfig: async () => (created ? winner : null),
      createConfig: async () => { created = true; throw new Error('duplicate key value violates unique constraint "cc_configs_single_active"') },
      seedRows: async () => {}, getRows: async () => [], putRow: async () => {}, addChange: async () => {},
      getChanges: async () => [], getChangeById: async () => null, touchConfig: async () => {},
    })
    expect((await getOrCreateBaseConfig('me')).id).toBe('winner')
  })

  it('rollback restores a prior value and is itself audited', async () => {
    fakeStore()
    const cfg = await getOrCreateBaseConfig('f')
    await saveChanges(cfg.id, [{ category: 'pricing', key: 'proCents', value: toCents(699) }], 'f')
    const change = (await getHistory(cfg.id))[0]
    await revertChange(cfg.id, change.id, 'f')
    expect((await getResolvedAssumptions(cfg.id)).pricing.proCents).toBe(toCents(597)) // back to default
    expect((await getHistory(cfg.id)).length).toBe(2) // original + rollback both logged
  })
})
