import { NextRequest, NextResponse } from 'next/server'
import { requireFounderApi } from '@/lib/command-center/api-guard'
import { enforce } from '@/lib/ratelimit'
import { ASSUMPTION_REGISTRY, SECTIONS } from '@/lib/command-center/schema'
import { flatten, defaultValue } from '@/lib/command-center/resolve'
import { validatePlanMix } from '@/lib/command-center/defaults'
import { getOrCreateBaseConfig, getResolvedAssumptions, saveChanges, resetSection, resetAll, revertChange, getHistory } from '@/lib/command-center/store'

// GET → the active config + every assumption (value + default + metadata), grouped by section.
export async function GET() {
  const f = await requireFounderApi()
  if (f instanceof NextResponse) return f
  const cfg = await getOrCreateBaseConfig(f.email)
  const resolved = await getResolvedAssumptions(cfg.id)
  const values = Object.fromEntries(flatten(resolved).map((r) => [`${r.category}.${r.key}`, r.numeric_value]))
  const sections = SECTIONS.map((section) => ({
    section,
    items: ASSUMPTION_REGISTRY.filter((d) => d.section === section).map((d) => ({
      category: d.category, key: d.key, label: d.label, unit: d.unit, type: d.type,
      value: values[`${d.category}.${d.key}`], default: defaultValue(d.category, d.key),
    })),
  }))
  return NextResponse.json({ config: { id: cfg.id, name: cfg.name, updatedAt: cfg.updatedAt, updatedBy: cfg.updatedBy }, sections, history: await getHistory(cfg.id, 25) })
}

// PATCH → save edits / reset section / reset all / revert a change. All mutations are audited by the store.
export async function PATCH(req: NextRequest) {
  const f = await requireFounderApi()
  if (f instanceof NextResponse) return f
  const flood = await enforce('command_center', `cc:${f.email}`)
  if (flood) return flood

  const cfg = await getOrCreateBaseConfig(f.email)
  let body: { action?: string; changes?: Array<{ category: string; key: string; value: number }>; section?: string; changeId?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  try {
    if (body.action === 'resetAll') return NextResponse.json({ ok: true, applied: await resetAll(cfg.id, f.email) })
    if (body.action === 'resetSection' && body.section) return NextResponse.json({ ok: true, applied: await resetSection(cfg.id, body.section, f.email) })
    if (body.action === 'revert' && body.changeId) return NextResponse.json({ ok: true, applied: await revertChange(cfg.id, body.changeId, f.email) })

    const changes = Array.isArray(body.changes) ? body.changes : []
    // Only known keys, finite numbers.
    const valid = changes.filter((c) => ASSUMPTION_REGISTRY.some((d) => d.category === c.category && d.key === c.key) && Number.isFinite(c.value))
    if (!valid.length) return NextResponse.json({ error: 'No valid changes' }, { status: 400 })

    // Server-side plan-mix validation (must total 100%).
    const resolved = await getResolvedAssumptions(cfg.id)
    for (const c of valid) if (c.category === 'mix') (resolved.mix as unknown as Record<string, number>)[c.key] = c.value
    const mixErr = valid.some((c) => c.category === 'mix') ? validatePlanMix(resolved.mix) : null
    if (mixErr) return NextResponse.json({ error: mixErr }, { status: 400 })

    return NextResponse.json({ ok: true, applied: await saveChanges(cfg.id, valid, f.email) })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Save failed' }, { status: 500 })
  }
}
