import { engineSnapshots } from './metrics'
import { computePriorities, type Priority } from './priorities'
import { playbookForEngine, PLAYBOOKS } from './playbooks'
import type { ForecastResult, MonthForecast, EngineKey, Health } from './types'
import type { Cents } from './money'

// Engine object model — each of the 4 growth engines as a first-class object. Phase 2 fills output /
// forecast / health / contribution / playbook / bottlenecks; goals, KPIs, actuals, tasks and the weekly
// scoreboard slot in over the next phases (the shape is designed for them).

export interface EngineModel {
  key: EngineKey
  label: string
  health: Health
  trend: 'up' | 'flat' | 'down'
  contributionPct: number
  currentMrrCents: Cents
  customers: number
  addsPerMonth: number
  playbookKey?: string
  forecast12: { month: number; mrrCents: Cents }[]
  bottlenecks: Priority[]
}

function engineMrr(m: MonthForecast, key: EngineKey): Cents {
  switch (key) {
    case 'direct': return m.directMrrCents
    case 'affiliate': return m.affiliateGrossMrrCents
    case 'whiteLabel': return m.whiteLabelMrrCents
    case 'expansion': return m.expansionMrrCents
  }
}

export function assembleEngines(f: ForecastResult, monthIndex = 0): EngineModel[] {
  const snaps = engineSnapshots(f, monthIndex)
  const priorities = computePriorities(f, monthIndex)
  return snaps.map((s) => ({
    key: s.key, label: s.label, health: s.health, trend: s.trend,
    contributionPct: s.contributionPct, currentMrrCents: s.mrrCents, customers: s.customers, addsPerMonth: s.addsThisMonth,
    playbookKey: playbookForEngine(s.key)?.key,
    forecast12: f.months.slice(monthIndex, monthIndex + 12).map((m) => ({ month: m.month, mrrCents: engineMrr(m, s.key) })),
    bottlenecks: priorities.filter((p) => p.playbookKey != null && PLAYBOOKS[p.playbookKey]?.engine === s.key),
  }))
}
