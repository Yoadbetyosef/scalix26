// Workload-based capacity planning (Team V2). Capacity is driven by REAL demand (support hours, onboarding
// accounts, CS customers, producing agencies, active affiliates, sales opportunities) — NEVER by raw customer
// count. A hire is only recommended when a real demand driver exceeds target-utilization capacity. Pure + tested.

export const DEPARTMENTS = ['engineering', 'product', 'sales', 'marketing', 'affiliate', 'partner_success', 'onboarding', 'customer_success', 'support', 'finance', 'operations', 'executive'] as const
export type Department = typeof DEPARTMENTS[number]
export const DRIVERS = ['support_hours', 'onboarding_accounts', 'sales_opportunities', 'active_affiliates', 'producing_agencies', 'cs_customers', 'manual'] as const
export type CapacityDriver = typeof DRIVERS[number]

export interface TeamRole {
  id: string; department: Department; role: string
  currentHeadcount: number; plannedHeadcount: number
  monthlySalaryCents: number; commissionCents: number; payrollBurdenPct: number
  startDate: string | null; capacityDriver: CapacityDriver; capacityPerEmployee: number; targetUtilization: number
  notes: string | null; updatedBy: string | null; updatedAt: string | null
}
export const emptyRole = (id: string): TeamRole => ({ id, department: 'operations', role: '', currentHeadcount: 0, plannedHeadcount: 0, monthlySalaryCents: 0, commissionCents: 0, payrollBurdenPct: 0, startDate: null, capacityDriver: 'manual', capacityPerEmployee: 0, targetUtilization: 0.8, notes: null, updatedBy: null, updatedAt: null })

export type CapacityStatus = 'under' | 'healthy' | 'near' | 'overloaded' | 'unknown'
export interface HiringRecommendation { why: string; gapUnits: number; monthlyCostCents: number; serviceImpact: string; growthImpact: string }
export interface RoleWorkload {
  role: TeamRole
  demandUnits: number | null; demandAvailable: boolean; driverLabel: string
  rawCapacity: number; utilization: number | null; backlog: number; status: CapacityStatus
  fullyLoadedMonthlyCents: number; nextHireNeeded: boolean; recommendation: HiringRecommendation | null
}

export const costPerHeadCents = (r: TeamRole): number => Math.round(r.monthlySalaryCents + r.commissionCents + r.monthlySalaryCents * r.payrollBurdenPct)
export const fullyLoadedMonthlyCents = (r: TeamRole): number => costPerHeadCents(r) * r.currentHeadcount

const DRIVER_LABEL: Record<CapacityDriver, string> = {
  support_hours: 'support demand hours', onboarding_accounts: 'accounts in onboarding', sales_opportunities: 'qualified opportunities',
  active_affiliates: 'active affiliates', producing_agencies: 'producing agencies', cs_customers: 'activated customers', manual: 'manual',
}
const WHY: Partial<Record<CapacityDriver, string>> = {
  support_hours: 'Support demand exceeds target-utilization capacity',
  onboarding_accounts: 'Accounts in onboarding exceed capacity per specialist',
  sales_opportunities: 'Qualified opportunities exceed capacity per rep',
  active_affiliates: 'Active affiliates exceed capacity per manager',
  producing_agencies: 'Producing agencies exceed capacity per partner manager',
  cs_customers: 'Activated customers exceed capacity per CSM',
}

// demandUnits: null when the driver has no reliable source yet (Manual/Waiting) — then no auto-recommendation.
export function roleWorkload(role: TeamRole, demandUnits: number | null): RoleWorkload {
  const rawCapacity = role.currentHeadcount * role.capacityPerEmployee
  const driverLabel = DRIVER_LABEL[role.capacityDriver]
  const flc = fullyLoadedMonthlyCents(role)
  const base = { role, demandUnits, demandAvailable: demandUnits != null, driverLabel, rawCapacity, fullyLoadedMonthlyCents: flc }

  if (demandUnits == null || role.capacityDriver === 'manual') {
    return { ...base, utilization: null, backlog: 0, status: 'unknown', nextHireNeeded: false, recommendation: null }
  }
  if (rawCapacity <= 0) {
    const overloaded = demandUnits > 0
    return { ...base, utilization: overloaded ? Infinity : null, backlog: Math.max(0, demandUnits), status: overloaded ? 'overloaded' : 'unknown', nextHireNeeded: overloaded, recommendation: overloaded ? hire(role, demandUnits, demandUnits) : null }
  }
  const util = demandUnits / rawCapacity
  const targetCapacity = rawCapacity * role.targetUtilization
  const status: CapacityStatus = util >= 1 ? 'overloaded' : util >= role.targetUtilization ? 'near' : util >= role.targetUtilization * 0.5 ? 'healthy' : 'under'
  const nextHireNeeded = demandUnits > targetCapacity
  const gap = Math.max(0, demandUnits - targetCapacity)
  return { ...base, utilization: util, backlog: Math.max(0, demandUnits - rawCapacity), status, nextHireNeeded, recommendation: nextHireNeeded ? hire(role, gap, demandUnits) : null }
}

function hire(role: TeamRole, gapUnits: number, demandUnits: number): HiringRecommendation {
  return {
    why: WHY[role.capacityDriver] ?? 'Demand exceeds capacity',
    gapUnits: Math.round(gapUnits * 100) / 100,
    monthlyCostCents: costPerHeadCents(role),
    serviceImpact: `Relieves ~${Math.round(gapUnits)} ${DRIVER_LABEL[role.capacityDriver]} over target capacity`,
    growthImpact: demandUnits > 0 ? `Restores headroom to keep serving ${Math.round(demandUnits)} ${DRIVER_LABEL[role.capacityDriver]}` : 'Adds capacity headroom',
  }
}

export interface CapacityDistribution { under: number; healthy: number; near: number; overloaded: number; unknown: number }
export function capacityDistribution(workloads: RoleWorkload[]): CapacityDistribution {
  const d: CapacityDistribution = { under: 0, healthy: 0, near: 0, overloaded: 0, unknown: 0 }
  for (const w of workloads) d[w.status]++
  return d
}
