import { northStar, engineSnapshots, timeToTargetMonths, type NorthStar, type EngineSnapshot } from './metrics'
import { computePriorities, type Priority } from './priorities'
import { compactMoney, pctText, num } from './format'
import type { ForecastResult } from './types'

// CEO Brief — the "four questions" every screen must answer, produced deterministically today. This is the
// operating-system contract: never just numbers. Consumed by the Overview header.

export interface CeoBrief {
  source: 'deterministic' | 'ai'
  month: number
  whereAreWe: string
  whereGoing: string
  whatStopping: string
  whatNext: string
  topPriorities: Priority[]
}

export function buildCeoBrief(f: ForecastResult, monthIndex = 0): CeoBrief {
  const ns = northStar(f, monthIndex)
  const pr = computePriorities(f, monthIndex)
  const ttt = timeToTargetMonths(f, f.assumptions.targets.targetArrCents)
  const top = pr[0]
  return {
    source: 'deterministic',
    month: monthIndex + 1,
    whereAreWe: `MRR ${compactMoney(ns.mrrCents)}, ${num(ns.customers)} customers, ${pctText(ns.grossMargin)} gross margin.`,
    whereGoing: `ARR ${compactMoney(ns.arrCents)} toward the ${compactMoney(ns.targetArrCents)} target — ${ttt ? `~${(ttt / 12).toFixed(1)} yrs to target ARR at plan` : 'target not reached within the horizon at plan'}.`,
    whatStopping: top ? `${top.title}: ${top.detail}` : 'No critical constraints flagged at this snapshot.',
    whatNext: top ? top.recommendedAction : 'Maintain the plan; review the weekly scoreboard.',
    topPriorities: pr.slice(0, 3),
  }
}

// ── Future AI-CEO seam ───────────────────────────────────────────────────────────────────────────────
// The exact payload a future AI advisor will consume to generate executive recommendations. Today the
// CeoBrief is deterministic; a later phase adds an AI producer over this SAME contract (source → 'ai').
// No AI is implemented now.
export interface AdvisorInput {
  month: number
  northStar: NorthStar
  engines: EngineSnapshot[]
  priorities: Priority[]
}
export function buildAdvisorInput(f: ForecastResult, monthIndex = 0): AdvisorInput {
  return { month: monthIndex + 1, northStar: northStar(f, monthIndex), engines: engineSnapshots(f, monthIndex), priorities: computePriorities(f, monthIndex) }
}
