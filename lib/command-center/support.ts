// Operational Support Proxy (NOT tickets — there is no ticket system yet). Derived from conversations
// (human-takeover + open) + error states; handling time is a Manual assumption. Built so a real ticket
// system can replace the adapter later without changing this math. Pure + golden-tested.

export interface SupportDemandInputs {
  requests: number          // Derived Support Proxy count
  avgHandlingMinutes: number // Manual assumption
}
export function demandHours(i: SupportDemandInputs): number {
  return (i.requests * i.avgHandlingMinutes) / 60
}

export interface SupportCapacityInputs {
  headcount: number
  productiveHoursEachPerPeriod: number
  utilizationTarget: number // 0..1
}
export const availableHours = (c: SupportCapacityInputs): number => c.headcount * c.productiveHoursEachPerPeriod
export const utilization = (demandH: number, availableH: number): number => (availableH > 0 ? demandH / availableH : 0)

export interface SupportLoad {
  demandHours: number
  availableHours: number
  utilization: number
  overloaded: boolean
  requiredHeadcount: number // to hit the utilization target
  nextHireNeeded: boolean
}
export function supportLoad(d: SupportDemandInputs, c: SupportCapacityInputs): SupportLoad {
  const demand = demandHours(d)
  const avail = availableHours(c)
  const util = utilization(demand, avail)
  const targetHoursPerHead = c.productiveHoursEachPerPeriod * (c.utilizationTarget > 0 ? c.utilizationTarget : 1)
  const requiredHeadcount = targetHoursPerHead > 0 ? Math.ceil(demand / targetHoursPerHead) : 0
  return { demandHours: demand, availableHours: avail, utilization: util, overloaded: util > 1, requiredHeadcount, nextHireNeeded: requiredHeadcount > c.headcount }
}
