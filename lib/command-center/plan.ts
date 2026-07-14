import { enginePlans, type EngineAllocation, type EngineRates, type EnginePlans } from './plan-engines'
import { type WorkCalendar, remainingWorkingDaysThisWeek, monthWorkingDays } from './plan-calendar'

// Plan — the business NAVIGATION system. The founder sets only the destination; everything is calculated
// BACKWARD from reality. Daily pace uses the ACTUAL remaining WORKING days in the founder's timezone (NO
// hardcoded 5-day or 7-day divisor). Every action carries a "how was this calculated" breakdown and a
// required-vs-feasible capacity check. Missing rate → "Input Required"; never invented. Pure + tested.

export type PrimaryMetric = 'arr_cents' | 'mrr_cents' | 'paying_customers' | 'revenue' | 'profit'
export type PaceStatus = 'ahead' | 'on_track' | 'behind' | 'no_data'

export interface PlanConfig { primaryMetric: PrimaryMetric; annualTarget: number; startDate: string; targetDate: string | null; arpuTargetCents: number | null; monthlyGoalOverride: number | null; allocation: EngineAllocation; calendar: WorkCalendar }
export interface EngineCapacity { directOutreachPerDay: number | null } // available team capacity/day (null = not configured)
export interface PlanInputs {
  config: PlanConfig
  currentValue: number; currentCustomers: number; currentArpuCents: number
  monthActual: number; weekActual: number; weekPrior: number
  engineRates: EngineRates; capacity: EngineCapacity; riskActions: DailyAction[]; nowMs: number
}

const DAY = 86_400_000
const monthsBetween = (fromMs: number, toIso: string) => (new Date(toIso).getTime() - fromMs) / (30 * DAY)

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
const pct = (x: number) => `${(x * 100).toFixed(2)}%`

export const FEASIBILITY_LEVERS = ['Increase headcount', 'Improve conversion rate', 'Increase ARPU', 'Extend the target date', 'Shift allocation to Affiliate / White Label', 'Add paid acquisition', 'Reduce the target']

export interface YearView {
  metric: PrimaryMetric; target: number; current: number; gap: number; progressPct: number; behindPct: number
  startDate: string; targetDate: string | null; monthsRemaining: number | null; requiredMonthlyGrowth: number | null
  requiredCustomersCurrentArpu: number | null; requiredCustomersTargetArpu: number | null; status: PaceStatus
}
export interface MonthView { requirement: number; actual: number; remaining: number; workingDaysRemaining: number; workingDaysTotal: number; requiredDailyPace: number; forecastMonthEnd: number; status: PaceStatus }
export interface WeekView { requirement: number; actual: number; remaining: number; prior: number; workingDaysRemaining: number; status: PaceStatus }
export interface CalcStep { label: string; value: string }
export interface DailyAction {
  key: string; action: string; why: string; relatedGoal: string; expectedImpact: string; engine?: string
  exactDailyPace?: number; dailyTarget?: number
  capacityPerDay?: number | null; feasible?: boolean | null; capacityGapPerDay?: number | null; levers?: string[]
  calc?: CalcStep[]
}
export interface PlanCascade { year: YearView; month: MonthView; week: WeekView; weekEngines: EnginePlans; today: DailyAction[]; netNewNeeded: number | null; isWorkingDay: boolean }

export function computePlan(i: PlanInputs): PlanCascade {
  const { config: c, nowMs } = i
  const cal = c.calendar
  const monthsRemaining = c.targetDate ? Math.max(0, monthsBetween(nowMs, c.targetDate)) : null
  const totalMonths = c.targetDate ? Math.max(0.0001, monthsBetween(new Date(c.startDate).getTime(), c.targetDate)) : null
  const elapsedFrac = totalMonths != null && monthsRemaining != null ? Math.min(1, Math.max(0, (totalMonths - monthsRemaining) / totalMonths)) : null

  const reqCustCur = requiredCustomers(c.primaryMetric, c.annualTarget, i.currentArpuCents)
  const reqCustTgt = c.arpuTargetCents ? requiredCustomers(c.primaryMetric, c.annualTarget, c.arpuTargetCents) : null
  const progressPct = c.annualTarget > 0 ? i.currentValue / c.annualTarget : 0
  const requiredMonthlyGrowth = i.currentValue > 0 && monthsRemaining && monthsRemaining > 0 ? Math.pow(c.annualTarget / i.currentValue, 1 / monthsRemaining) - 1 : null

  const year: YearView = {
    metric: c.primaryMetric, target: c.annualTarget, current: i.currentValue, gap: Math.max(0, c.annualTarget - i.currentValue),
    progressPct, behindPct: elapsedFrac != null ? (elapsedFrac - progressPct) * 100 : 0,
    startDate: c.startDate, targetDate: c.targetDate, monthsRemaining, requiredMonthlyGrowth,
    requiredCustomersCurrentArpu: reqCustCur, requiredCustomersTargetArpu: reqCustTgt, status: paceStatus(progressPct, elapsedFrac),
  }

  const netNewNeeded = reqCustCur != null ? Math.max(0, reqCustCur - i.currentCustomers) : null
  const canPace = monthsRemaining != null && monthsRemaining > 0
  const derivedMonthly = netNewNeeded != null && canPace ? Math.ceil(netNewNeeded / monthsRemaining!) : 0
  const monthReq = c.monthlyGoalOverride != null ? c.monthlyGoalOverride : derivedMonthly

  const mwd = monthWorkingDays(nowMs, cal)
  const remWorkWeek = remainingWorkingDaysThisWeek(nowMs, cal)
  const isWorkingDay = remWorkWeek > 0
  const month: MonthView = {
    requirement: monthReq, actual: i.monthActual, remaining: Math.max(0, monthReq - i.monthActual),
    workingDaysRemaining: mwd.remaining, workingDaysTotal: mwd.total,
    requiredDailyPace: mwd.remaining > 0 ? (monthReq - i.monthActual) / mwd.remaining : Math.max(0, monthReq - i.monthActual),
    forecastMonthEnd: mwd.elapsed > 0 ? Math.round((i.monthActual / mwd.elapsed) * mwd.total) : i.monthActual,
    status: paceStatus(i.monthActual, mwd.elapsed > 0 ? monthReq * (mwd.elapsed / mwd.total) : null),
  }

  // Weekly requirement scales with working days (no magic constant): monthReq × workingDaysPerWeek / monthWorkingDays.
  const weekReq = mwd.total > 0 ? Math.ceil(monthReq * cal.workingDaysPerWeek / mwd.total) : monthReq
  const week: WeekView = { requirement: weekReq, actual: i.weekActual, remaining: Math.max(0, weekReq - i.weekActual), prior: i.weekPrior, workingDaysRemaining: remWorkWeek, status: paceStatus(i.weekActual, weekReq > 0 ? weekReq : null) }

  const weekEngines = enginePlans(week.remaining, i.engineRates, c.allocation)
  const today = buildToday({ e: weekEngines, remWorkWeek, workingDaysPerWeek: cal.workingDaysPerWeek, rates: i.engineRates, capacity: i.capacity, risk: i.riskActions, hasDate: !!c.targetDate || c.monthlyGoalOverride != null })
  return { year, month, week, weekEngines, today, netNewNeeded, isWorkingDay }
}

interface TodayCtx { e: EnginePlans; remWorkWeek: number; workingDaysPerWeek: number; rates: EngineRates; capacity: EngineCapacity; risk: DailyAction[]; hasDate: boolean }

// Redistribute the REMAINING weekly funnel across the REMAINING working days this week. Exact pace kept for the
// explanation; concrete target rounded up only when needed. Required activity is checked against team capacity.
export function buildToday(ctx: TodayCtx): DailyAction[] {
  const out: DailyAction[] = []
  if (!ctx.hasDate) { out.push({ key: 'set_destination', action: 'Set a target date to activate your plan', why: 'Without a deadline the system cannot calculate a required pace, so no daily activity is generated.', relatedGoal: 'Destination', expectedImpact: '—' }); return [...out, ...ctx.risk] }
  if (ctx.remWorkWeek <= 0) { out.push({ key: 'rest_day', action: 'Rest day — not a working day in your plan', why: `Your plan uses ${ctx.workingDaysPerWeek} working day(s)/week; today is outside them.`, relatedGoal: 'Working calendar', expectedImpact: '—' }); return [...out, ...ctx.risk] }
  const per = (weekly: number) => weekly / ctx.remWorkWeek

  const d = ctx.e.direct
  if (d.customers > 0) {
    if (d.funnel) {
      const f = d.funnel
      const exact = per(f.outreach), target = Math.ceil(exact)
      const cap = ctx.capacity.directOutreachPerDay
      const feasible = cap == null ? null : target <= cap
      const r = ctx.rates.direct
      out.push({
        key: 'direct_outreach', engine: 'direct', action: `Contact ${target.toLocaleString()} businesses today`,
        why: `Direct needs ${d.customers}/week → ${f.demos} demos → ${f.outreach.toLocaleString()} outreach, spread over ${ctx.remWorkWeek} remaining working day(s).`,
        relatedGoal: 'Weekly customer plan', expectedImpact: `Skipping today pushes ~${Math.ceil(per(d.customers) * 100) / 100} customers into the gap`,
        exactDailyPace: Math.round(exact * 100) / 100, dailyTarget: target,
        capacityPerDay: cap, feasible, capacityGapPerDay: cap == null ? null : Math.max(0, target - cap), levers: feasible === false ? FEASIBILITY_LEVERS : undefined,
        calc: [
          { label: 'Direct customers / week', value: String(d.customers) }, { label: 'Close rate', value: pct(r.closeRate) }, { label: 'Required demos / week', value: String(f.demos) },
          { label: 'Show rate', value: pct(r.showRate) }, { label: 'Required meetings / week', value: String(f.meetings) }, { label: 'Booking rate', value: pct(r.bookRate) },
          { label: 'Required conversations / week', value: String(f.conversations) }, { label: 'Response rate', value: pct(r.responseRate) }, { label: 'Required outreach / week', value: f.outreach.toLocaleString() },
          { label: 'Remaining working days this week', value: String(ctx.remWorkWeek) }, { label: 'Exact daily pace', value: `${exact.toFixed(1)}/day` }, { label: 'Rounded daily target', value: `${target.toLocaleString()}/day` },
          ...(cap != null ? [{ label: 'Team capacity / day', value: cap.toLocaleString() }, { label: 'Feasible?', value: feasible ? 'Yes' : `No — gap ${(target - cap).toLocaleString()}/day` }] : []),
        ],
      })
      out.push({ key: 'direct_demos', engine: 'direct', action: `Book ${Math.ceil(per(f.demos))} demo${Math.ceil(per(f.demos)) > 1 ? 's' : ''} today`, why: `${f.demos} demos/week over ${ctx.remWorkWeek} working day(s).`, relatedGoal: 'Weekly customer plan', expectedImpact: `Toward ${d.customers} direct customers/week`, exactDailyPace: Math.round(per(f.demos) * 100) / 100, dailyTarget: Math.ceil(per(f.demos)) })
    } else out.push({ key: 'direct_input', engine: 'direct', action: 'Input Required: set Direct close/show/booking/response rates in Settings', why: 'Direct daily activity needs real conversion rates — none invented.', relatedGoal: 'Weekly customer plan', expectedImpact: '—' })
  }
  const af = ctx.e.affiliate
  if (af.customers > 0) {
    if (af.funnel) { const t = Math.ceil(per(af.funnel.recruitedAffiliates)); out.push({ key: 'affiliate_recruit', engine: 'affiliate', action: `Recruit ${t} affiliate${t > 1 ? 's' : ''} today`, why: `${af.customers}/week need ${af.funnel.recruitedAffiliates} recruits, over ${ctx.remWorkWeek} working day(s).`, relatedGoal: 'Weekly customer plan', expectedImpact: `Toward ${af.customers} affiliate customers/week`, exactDailyPace: Math.round(per(af.funnel.recruitedAffiliates) * 100) / 100, dailyTarget: t, calc: [{ label: 'Affiliate customers / week', value: String(af.customers) }, { label: 'Required recruits / week', value: String(af.funnel.recruitedAffiliates) }, { label: 'Remaining working days', value: String(ctx.remWorkWeek) }, { label: 'Exact daily pace', value: `${per(af.funnel.recruitedAffiliates).toFixed(1)}/day` }] }) }
    else out.push({ key: 'affiliate_input', engine: 'affiliate', action: 'Input Required: set Affiliate activation + customers-per-affiliate in Settings', why: 'Affiliate targets need real rates.', relatedGoal: 'Weekly customer plan', expectedImpact: '—' })
  }
  const w = ctx.e.whiteLabel
  if (w.customers > 0) {
    if (w.funnel) { const t = Math.ceil(per(w.funnel.meetings)); out.push({ key: 'wl_meetings', engine: 'whiteLabel', action: `Schedule ${t} agency meeting${t > 1 ? 's' : ''} today`, why: `${w.customers}/week need ${w.funnel.meetings} meetings, over ${ctx.remWorkWeek} working day(s).`, relatedGoal: 'Weekly customer plan', expectedImpact: `Toward ${w.customers} WL customers/week`, exactDailyPace: Math.round(per(w.funnel.meetings) * 100) / 100, dailyTarget: t, calc: [{ label: 'WL customers / week', value: String(w.customers) }, { label: 'Required meetings / week', value: String(w.funnel.meetings) }, { label: 'Remaining working days', value: String(ctx.remWorkWeek) }, { label: 'Exact daily pace', value: `${per(w.funnel.meetings).toFixed(1)}/day` }] }) }
    else out.push({ key: 'wl_input', engine: 'whiteLabel', action: 'Input Required: set White Label rates in Settings', why: 'White Label targets need real rates.', relatedGoal: 'Weekly customer plan', expectedImpact: '—' })
  }
  const ex = ctx.e.expansion
  if (ex.mrrCents > 0 && ex.funnel) { const t = Math.ceil(per(ex.funnel.offers)); out.push({ key: 'expansion_offers', engine: 'expansion', action: `Send ${t} expansion offer${t > 1 ? 's' : ''} today`, why: `Expansion share needs ${ex.funnel.offers} offers/week over ${ctx.remWorkWeek} working day(s).`, relatedGoal: 'Weekly customer plan', expectedImpact: 'Toward the expansion share of the gap', exactDailyPace: Math.round(per(ex.funnel.offers) * 100) / 100, dailyTarget: t }) }

  return [...out, ...ctx.risk]
}
