import { enginePlans, type EngineAllocation, type EngineRates, type EnginePlans } from './plan-engines'

// Plan — the business NAVIGATION system. The founder sets only the destination (metric + target + date +
// editable engine allocation). Everything else is calculated BACKWARD from reality: gap → required customers
// (at real ARPU) → split by engine → per-engine funnels → time-translated to Today's concrete actions, each
// with a "why" and its impact on the annual gap. Uses only real reality + persisted assumptions. If a rate is
// missing we say "Input Required" — never invent one. Pure + tested; recomputed every load (dynamic).

export type PrimaryMetric = 'arr_cents' | 'mrr_cents' | 'paying_customers' | 'revenue' | 'profit'
export type PaceStatus = 'ahead' | 'on_track' | 'behind' | 'no_data'

export interface PlanConfig { primaryMetric: PrimaryMetric; annualTarget: number; startDate: string; targetDate: string | null; arpuTargetCents: number | null; monthlyGoalOverride: number | null; allocation: EngineAllocation }
export interface PlanInputs {
  config: PlanConfig
  currentValue: number; currentCustomers: number; currentArpuCents: number
  monthActual: number; weekActual: number; weekPrior: number
  engineRates: EngineRates; riskActions: DailyAction[]; nowMs: number
}

const DAY = 86_400_000
const daysInMonth = (nowMs: number) => { const d = new Date(nowMs); return new Date(d.getUTCFullYear(), d.getUTCMonth() + 1, 0).getUTCDate() }
const dayOfMonth = (nowMs: number) => new Date(nowMs).getUTCDate()
const monthsBetween = (fromMs: number, toIso: string) => (new Date(toIso).getTime() - fromMs) / (30 * DAY)
const daysLeftInWeek = (nowMs: number) => { const dow = new Date(nowMs).getUTCDay(); return Math.max(1, 7 - (dow === 0 ? 7 : dow)) }

function requiredCustomers(metric: PrimaryMetric, target: number, arpuCents: number): number | null {
  if (metric === 'paying_customers') return Math.ceil(target)
  if (arpuCents <= 0) return null
  if (metric === 'arr_cents') return Math.ceil(target / (arpuCents * 12))
  if (metric === 'mrr_cents') return Math.ceil(target / arpuCents)
  return null
}
function paceStatus(progress: number, expected: number | null): PaceStatus {
  if (expected == null) return 'no_data'
  if (expected <= 0) return progress > 0 ? 'ahead' : 'on_track'
  const ratio = progress / expected
  return ratio >= 1.05 ? 'ahead' : ratio >= 0.9 ? 'on_track' : 'behind'
}

export interface YearView {
  metric: PrimaryMetric; target: number; current: number; gap: number; progressPct: number; behindPct: number
  startDate: string; targetDate: string | null; monthsRemaining: number | null; requiredMonthlyGrowth: number | null
  requiredCustomersCurrentArpu: number | null; requiredCustomersTargetArpu: number | null; status: PaceStatus
}
export interface MonthView { requirement: number; actual: number; remaining: number; daysRemaining: number; requiredDailyPace: number; forecastMonthEnd: number; status: PaceStatus }
export interface WeekView { requirement: number; actual: number; remaining: number; prior: number; status: PaceStatus }
export interface DailyAction { key: string; action: string; why: string; relatedGoal: string; expectedImpact: string; engine?: string }
export interface PlanCascade { year: YearView; month: MonthView; week: WeekView; weekEngines: EnginePlans; today: DailyAction[]; netNewNeeded: number | null }

export function computePlan(i: PlanInputs): PlanCascade {
  const { config: c, nowMs } = i
  const monthsRemaining = c.targetDate ? Math.max(0, monthsBetween(nowMs, c.targetDate)) : null
  const totalMonths = c.targetDate ? Math.max(0.0001, monthsBetween(new Date(c.startDate).getTime(), c.targetDate)) : null
  const elapsedFrac = totalMonths != null && monthsRemaining != null ? Math.min(1, Math.max(0, (totalMonths - monthsRemaining) / totalMonths)) : null

  const reqCustCur = requiredCustomers(c.primaryMetric, c.annualTarget, i.currentArpuCents)
  const reqCustTgt = c.arpuTargetCents ? requiredCustomers(c.primaryMetric, c.annualTarget, c.arpuTargetCents) : null
  const progressPct = c.annualTarget > 0 ? i.currentValue / c.annualTarget : 0
  const requiredMonthlyGrowth = i.currentValue > 0 && monthsRemaining && monthsRemaining > 0 ? Math.pow(c.annualTarget / i.currentValue, 1 / monthsRemaining) - 1 : null
  const behindPct = elapsedFrac != null ? (elapsedFrac - progressPct) * 100 : 0 // >0 behind, <0 ahead

  const year: YearView = {
    metric: c.primaryMetric, target: c.annualTarget, current: i.currentValue, gap: Math.max(0, c.annualTarget - i.currentValue),
    progressPct, behindPct, startDate: c.startDate, targetDate: c.targetDate, monthsRemaining, requiredMonthlyGrowth,
    requiredCustomersCurrentArpu: reqCustCur, requiredCustomersTargetArpu: reqCustTgt, status: paceStatus(progressPct, elapsedFrac),
  }

  // Pacing REQUIRES a target date. Without one we do not fabricate a monthly requirement (that would dump the
  // whole gap into "this month"); the founder is prompted to set a date instead.
  const netNewNeeded = reqCustCur != null ? Math.max(0, reqCustCur - i.currentCustomers) : null
  const canPace = monthsRemaining != null && monthsRemaining > 0
  const derivedMonthly = netNewNeeded != null && canPace ? Math.ceil(netNewNeeded / monthsRemaining!) : 0
  const monthReq = c.monthlyGoalOverride != null ? c.monthlyGoalOverride : derivedMonthly
  const dim = daysInMonth(nowMs), dom = dayOfMonth(nowMs), daysRem = Math.max(0, dim - dom)
  const month: MonthView = {
    requirement: monthReq, actual: i.monthActual, remaining: Math.max(0, monthReq - i.monthActual), daysRemaining: daysRem,
    requiredDailyPace: daysRem > 0 ? (monthReq - i.monthActual) / daysRem : Math.max(0, monthReq - i.monthActual),
    forecastMonthEnd: dom > 0 ? Math.round((i.monthActual / dom) * dim) : i.monthActual,
    status: paceStatus(i.monthActual, monthReq * (dom / dim) > 0 ? monthReq * (dom / dim) : null),
  }

  const weekReq = Math.ceil(monthReq / 4.345)
  const week: WeekView = { requirement: weekReq, actual: i.weekActual, remaining: Math.max(0, weekReq - i.weekActual), prior: i.weekPrior, status: paceStatus(i.weekActual, weekReq > 0 ? weekReq : null) }

  // Back-calc the REMAINING weekly customers across engines, then translate to today.
  const weekEngines = enginePlans(week.remaining, i.engineRates, c.allocation)
  const today = buildToday(weekEngines, daysLeftInWeek(nowMs), i.riskActions)
  if (!c.targetDate && c.monthlyGoalOverride == null) today.unshift({ key: 'set_destination', action: 'Set a target date to activate your plan', why: 'Without a deadline the system cannot calculate a required pace, so no daily activity is generated.', relatedGoal: 'Destination', expectedImpact: '—' })
  return { year, month, week, weekEngines, today, netNewNeeded }
}

// Concrete daily actions from the weekly per-engine funnels + risk actions. Each says WHY and its gap impact.
export function buildToday(e: EnginePlans, daysLeft: number, riskActions: DailyAction[]): DailyAction[] {
  const out: DailyAction[] = []
  const perDay = (n: number) => Math.max(1, Math.ceil(n / daysLeft))
  const goal = 'Weekly customer plan'

  if (e.direct.customers > 0) {
    if (e.direct.funnel) {
      const f = e.direct.funnel
      out.push({ key: 'direct_outreach', engine: 'direct', action: `Contact ${perDay(f.outreach)} businesses today`, why: `Direct needs ${e.direct.customers} customers this week → ${f.demos} demos → ${f.outreach} outreach.`, relatedGoal: goal, expectedImpact: `Skipping ≈ +${perDay(e.direct.customers)} to the annual gap` })
      out.push({ key: 'direct_demos', engine: 'direct', action: `Book ${perDay(f.demos)} demo${f.demos > 1 ? 's' : ''} today`, why: `${f.demos} demos/week at your close rate deliver ${e.direct.customers} customers.`, relatedGoal: goal, expectedImpact: `Toward ${e.direct.customers} direct customers/week` })
    } else out.push({ key: 'direct_input', engine: 'direct', action: 'Input Required: set Direct close/show/booking/response rates in Settings', why: 'Direct daily activity needs real conversion rates — none invented.', relatedGoal: goal, expectedImpact: '—' })
  }
  if (e.affiliate.customers > 0) {
    if (e.affiliate.funnel) out.push({ key: 'affiliate_recruit', engine: 'affiliate', action: `Recruit ${perDay(e.affiliate.funnel.recruitedAffiliates)} affiliate${e.affiliate.funnel.recruitedAffiliates > 1 ? 's' : ''} today`, why: `${e.affiliate.customers} affiliate customers/week need ${e.affiliate.funnel.productiveAffiliates} productive affiliates → ${e.affiliate.funnel.recruitedAffiliates} recruited.`, relatedGoal: goal, expectedImpact: `Toward ${e.affiliate.customers} affiliate customers/week` })
    else out.push({ key: 'affiliate_input', engine: 'affiliate', action: 'Input Required: set Affiliate activation + customers-per-affiliate in Settings', why: 'Affiliate targets need real rates.', relatedGoal: goal, expectedImpact: '—' })
  }
  if (e.whiteLabel.customers > 0) {
    if (e.whiteLabel.funnel) out.push({ key: 'wl_meetings', engine: 'whiteLabel', action: `Schedule ${perDay(e.whiteLabel.funnel.meetings)} agency meeting${e.whiteLabel.funnel.meetings > 1 ? 's' : ''} today`, why: `${e.whiteLabel.customers} WL customers/week need ${e.whiteLabel.funnel.agencies} producing agencies → ${e.whiteLabel.funnel.meetings} meetings.`, relatedGoal: goal, expectedImpact: `Toward ${e.whiteLabel.customers} WL customers/week` })
    else out.push({ key: 'wl_input', engine: 'whiteLabel', action: 'Input Required: set White Label rates in Settings', why: 'White Label targets need real rates.', relatedGoal: goal, expectedImpact: '—' })
  }
  if (e.expansion.mrrCents > 0 && e.expansion.funnel) out.push({ key: 'expansion_offers', engine: 'expansion', action: `Send ${perDay(e.expansion.funnel.offers)} expansion offer${e.expansion.funnel.offers > 1 ? 's' : ''} today`, why: `Expansion share ≈ $${(e.expansion.mrrCents / 100).toFixed(0)}/mo needs ${e.expansion.funnel.eligible} eligible customers offered.`, relatedGoal: goal, expectedImpact: 'Toward the expansion share of the gap' })

  return [...out, ...riskActions]
}
