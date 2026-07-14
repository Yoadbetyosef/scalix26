// Costs — actual/manual cost items normalized to a monthly run-rate. Forecast costs come from the forecast
// engine (separate layer); these are Actual/Manual. Pure + tested.

export type CostType = 'cogs' | 'opex'
export type Recurrence = 'one_time' | 'monthly' | 'annual'
export interface CostItem {
  id: string; costType: CostType; category: string; vendor: string | null; amountCents: number
  recurrence: Recurrence; startDate: string; endDate: string | null; notes: string | null; owner: string | null
  sourceClassification: string; updatedBy: string | null; updatedAt: string | null
}

// Monthly run-rate contribution of a single cost (one-time costs are NOT part of the recurring run-rate).
export const monthlyCents = (c: { amountCents: number; recurrence: Recurrence }): number =>
  c.recurrence === 'monthly' ? c.amountCents : c.recurrence === 'annual' ? Math.round(c.amountCents / 12) : 0

export const isActive = (c: { startDate: string; endDate: string | null }, nowIso: string): boolean => {
  const now = nowIso.slice(0, 10)
  return c.startDate <= now && (c.endDate == null || c.endDate >= now)
}

export interface CostSummary {
  monthlyCogsCents: number; monthlyOpexCents: number; monthlyTotalCents: number
  oneTimeActiveCents: number
  byCategory: Array<{ costType: CostType; category: string; monthlyCents: number }>
}
export function summarizeCosts(items: CostItem[], nowIso: string): CostSummary {
  const active = items.filter((c) => isActive(c, nowIso))
  const catMap = new Map<string, { costType: CostType; category: string; monthlyCents: number }>()
  let cogs = 0, opex = 0, oneTime = 0
  for (const c of active) {
    const m = monthlyCents(c)
    if (c.recurrence === 'one_time') oneTime += c.amountCents
    if (c.costType === 'cogs') cogs += m; else opex += m
    const key = `${c.costType}:${c.category}`
    const e = catMap.get(key) ?? { costType: c.costType, category: c.category, monthlyCents: 0 }
    e.monthlyCents += m
    catMap.set(key, e)
  }
  return { monthlyCogsCents: cogs, monthlyOpexCents: opex, monthlyTotalCents: cogs + opex, oneTimeActiveCents: oneTime, byCategory: [...catMap.values()].filter((x) => x.monthlyCents > 0).sort((a, b) => b.monthlyCents - a.monthlyCents) }
}
