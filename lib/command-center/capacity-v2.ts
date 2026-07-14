// Workload-based capacity planning (Team V2), split into three truth-layers:
//   • Reality  — cc_team_reality: current org today (never includes planned/simulated hires)
//   • Plan     — cc_hiring_plan: future hires (payroll kept separate from reality)
//   • Config   — cc_capacity_model: capacity assumptions, versioned, period-explicit
// Capacity is driven by REAL demand, never raw customer count. Demand and capacity are normalized to the
// same period before computing utilization; each driver has explicit rate/stock semantics. Pure + tested.

export const DEPARTMENTS = ['engineering', 'product', 'sales', 'marketing', 'affiliate', 'partner_success', 'onboarding', 'customer_success', 'support', 'finance', 'operations', 'executive'] as const
export type Department = typeof DEPARTMENTS[number]
export const DRIVERS = ['support_hours', 'onboarding_accounts', 'sales_opportunities', 'active_affiliates', 'producing_agencies', 'cs_customers', 'manual'] as const
export type CapacityDriver = typeof DRIVERS[number]
export const PERIODS = ['day', 'week', 'month'] as const
export type CapacityPeriod = typeof PERIODS[number]
export const HIRING_STATUSES = ['proposed', 'approved', 'open', 'interviewing', 'offer', 'hired', 'on_hold', 'cancelled'] as const
export type HiringStatus = typeof HIRING_STATUSES[number]

// A driver is a RATE (flow per period, e.g. support hours/week) or a STOCK (level at a point in time, e.g.
// active accounts). Rate drivers require period normalization; stock drivers compare levels directly.
export type DriverKind = 'rate' | 'stock' | 'none'
export const DRIVER_KIND: Record<CapacityDriver, DriverKind> = {
  support_hours: 'rate', onboarding_accounts: 'stock', sales_opportunities: 'stock',
  active_affiliates: 'stock', producing_agencies: 'stock', cs_customers: 'stock', manual: 'none',
}
const PERIOD_DAYS: Record<CapacityPeriod, number> = { day: 1, week: 7, month: 30 }
export const normalizePeriod = (value: number, from: CapacityPeriod, to: CapacityPeriod): number => value * (PERIOD_DAYS[to] / PERIOD_DAYS[from])

export interface CapacityModel {
  id: string; roleKey: string; label: string; capacityDriver: CapacityDriver
  capacityPerEmployee: number; capacityUnit: string; capacityPeriod: CapacityPeriod
  demandMetricKey: string | null; targetUtilization: number; sourceClassification: string
  effectiveFrom: string; effectiveTo: string | null; status: 'active' | 'inactive'
  notes: string | null; updatedBy: string | null; updatedAt: string | null
}
export interface TeamRealityRole {
  id: string; department: Department; role: string; currentHeadcount: number
  monthlySalaryCents: number; commissionCents: number; payrollBurdenPct: number; capacityModelId: string | null
  effectiveFrom: string; effectiveTo: string | null; status: 'active' | 'inactive'
  notes: string | null; updatedBy: string | null; updatedAt: string | null
}
export interface HiringPlanRole {
  id: string; department: Department; role: string; headcount: number; plannedStartDate: string | null
  monthlySalaryCents: number; commissionCents: number; payrollBurdenPct: number; capacityModelId: string | null
  hiringReason: string | null; growthEngine: string | null; priority: 'low' | 'medium' | 'high' | null
  status: HiringStatus; notes: string | null; updatedBy: string | null; updatedAt: string | null
}

// Fully-loaded monthly cost per employee = base + commission + base×burden. Same formula for reality & plan.
export const costPerHeadCents = (salaryCents: number, commissionCents: number, burdenPct: number): number => Math.round(salaryCents + commissionCents + salaryCents * burdenPct)
export const realityPayrollCents = (r: TeamRealityRole): number => costPerHeadCents(r.monthlySalaryCents, r.commissionCents, r.payrollBurdenPct) * r.currentHeadcount
export const planPayrollCents = (h: HiringPlanRole): number => costPerHeadCents(h.monthlySalaryCents, h.commissionCents, h.payrollBurdenPct) * h.headcount

export type CapacityStatus = 'under' | 'healthy' | 'near' | 'overloaded' | 'unknown'
export interface HiringRecommendation { why: string; gapUnits: number; unit: string; monthlyCostCents: number; serviceImpact: string; growthImpact: string }

// Demand for a role: value plus (for RATE drivers) the period the value is expressed in. STOCK drivers omit period.
export interface DemandInput { value: number | null; period?: CapacityPeriod }

export interface RoleWorkload {
  role: TeamRealityRole; model: CapacityModel | null
  driverKind: DriverKind; demandAvailable: boolean
  demandNormalized: number | null   // in the model's capacity period/unit
  capacity: number                  // headcount × capacityPerEmployee (same period/unit as demandNormalized)
  utilization: number | null; backlog: number; status: CapacityStatus
  fullyLoadedMonthlyCents: number; nextHireNeeded: boolean; recommendation: HiringRecommendation | null
}

const WHY: Partial<Record<CapacityDriver, string>> = {
  support_hours: 'Support demand exceeds target-utilization capacity',
  onboarding_accounts: 'Accounts in onboarding exceed capacity per specialist',
  sales_opportunities: 'Qualified opportunities exceed capacity per rep',
  active_affiliates: 'Active affiliates exceed capacity per manager',
  producing_agencies: 'Producing agencies exceed capacity per partner manager',
  cs_customers: 'Activated customers exceed capacity per CSM',
}

export function roleWorkload(role: TeamRealityRole, model: CapacityModel | null, demand: DemandInput): RoleWorkload {
  const flc = realityPayrollCents(role)
  const base = { role, model, fullyLoadedMonthlyCents: flc }
  const kind: DriverKind = model ? DRIVER_KIND[model.capacityDriver] : 'none'

  if (!model || kind === 'none' || demand.value == null) {
    return { ...base, driverKind: kind, demandAvailable: false, demandNormalized: null, capacity: role.currentHeadcount * (model?.capacityPerEmployee ?? 0), utilization: null, backlog: 0, status: 'unknown', nextHireNeeded: false, recommendation: null }
  }
  // Normalize a RATE demand to the model's capacity period; a STOCK demand is a level (no conversion).
  const demandNorm = kind === 'rate' ? normalizePeriod(demand.value, demand.period ?? model.capacityPeriod, model.capacityPeriod) : demand.value
  const capacity = role.currentHeadcount * model.capacityPerEmployee
  if (capacity <= 0) {
    const overloaded = demandNorm > 0
    return { ...base, driverKind: kind, demandAvailable: true, demandNormalized: demandNorm, capacity, utilization: overloaded ? Infinity : null, backlog: Math.max(0, demandNorm), status: overloaded ? 'overloaded' : 'unknown', nextHireNeeded: overloaded, recommendation: overloaded ? hire(role, model, demandNorm, demandNorm) : null }
  }
  const util = demandNorm / capacity
  const targetCapacity = capacity * model.targetUtilization
  const status: CapacityStatus = util >= 1 ? 'overloaded' : util >= model.targetUtilization ? 'near' : util >= model.targetUtilization * 0.5 ? 'healthy' : 'under'
  const nextHireNeeded = demandNorm > targetCapacity
  const gap = Math.max(0, demandNorm - targetCapacity)
  return { ...base, driverKind: kind, demandAvailable: true, demandNormalized: demandNorm, capacity, utilization: util, backlog: Math.max(0, demandNorm - capacity), status, nextHireNeeded, recommendation: nextHireNeeded ? hire(role, model, gap, demandNorm) : null }
}

function hire(role: TeamRealityRole, model: CapacityModel, gapUnits: number, demandNorm: number): HiringRecommendation {
  const unit = `${model.capacityUnit}${DRIVER_KIND[model.capacityDriver] === 'rate' ? `/${model.capacityPeriod}` : ''}`
  return {
    why: WHY[model.capacityDriver] ?? 'Demand exceeds capacity',
    gapUnits: Math.round(gapUnits * 100) / 100, unit,
    monthlyCostCents: costPerHeadCents(role.monthlySalaryCents, role.commissionCents, role.payrollBurdenPct),
    serviceImpact: `Relieves ~${Math.round(gapUnits)} ${unit} over target capacity`,
    growthImpact: demandNorm > 0 ? `Restores headroom to serve ${Math.round(demandNorm)} ${unit}` : 'Adds capacity headroom',
  }
}

export interface CapacityDistribution { under: number; healthy: number; near: number; overloaded: number; unknown: number }
export function capacityDistribution(workloads: RoleWorkload[]): CapacityDistribution {
  const d: CapacityDistribution = { under: 0, healthy: 0, near: 0, overloaded: 0, unknown: 0 }
  for (const w of workloads) d[w.status]++
  return d
}

// Reality vs (Reality + Plan) — the projection is ALWAYS labeled separately; reality figures never include plan.
export interface HeadcountView { realityHeadcount: number; realityPayrollCents: number; plannedHeadcount: number; plannedPayrollCents: number; projectedHeadcount: number; projectedPayrollCents: number }
export function headcountView(reality: TeamRealityRole[], plan: HiringPlanRole[]): HeadcountView {
  const activePlan = plan.filter((h) => h.status !== 'cancelled' && h.status !== 'hired')
  const realityHeadcount = reality.reduce((s, r) => s + r.currentHeadcount, 0)
  const realityPay = reality.reduce((s, r) => s + realityPayrollCents(r), 0)
  const plannedHeadcount = activePlan.reduce((s, h) => s + h.headcount, 0)
  const plannedPay = activePlan.reduce((s, h) => s + planPayrollCents(h), 0)
  return { realityHeadcount, realityPayrollCents: realityPay, plannedHeadcount, plannedPayrollCents: plannedPay, projectedHeadcount: realityHeadcount + plannedHeadcount, projectedPayrollCents: realityPay + plannedPay }
}
