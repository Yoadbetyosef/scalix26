// Capacity Planner — DETERMINISTIC operational staffing needs by customer count. A threshold table maps
// customers → required headcount per role, and surfaces when the next hire is triggered. Editable defaults
// (Phase 2 lets the founder tune ratios); pure + unit-tested.

export interface CapacityRule {
  role: string
  department: string
  customersPerHire: number // one hire per N customers
  firstHireAtCustomers: number // no hire needed below this
}

export const CAPACITY_RULES: CapacityRule[] = [
  { role: 'Support Rep', department: 'Support', customersPerHire: 250, firstHireAtCustomers: 1 },
  { role: 'Onboarding Specialist', department: 'Customer Success', customersPerHire: 400, firstHireAtCustomers: 150 },
  { role: 'Customer Success Manager', department: 'Customer Success', customersPerHire: 300, firstHireAtCustomers: 300 },
  { role: 'Marketing Manager', department: 'Marketing', customersPerHire: 1500, firstHireAtCustomers: 750 },
  { role: 'Sales Manager', department: 'Sales', customersPerHire: 1000, firstHireAtCustomers: 1000 },
]

export interface CapacityNeed {
  role: string
  department: string
  required: number // headcount needed at this customer count
  nextHireAtCustomers: number // customer count that triggers the next incremental hire
}

export function capacityPlan(customers: number, rules: CapacityRule[] = CAPACITY_RULES): CapacityNeed[] {
  return rules.map((r) => {
    const required = customers < r.firstHireAtCustomers ? 0 : Math.max(1, Math.ceil((customers - r.firstHireAtCustomers + 1) / r.customersPerHire))
    const nextHireAtCustomers = required === 0 ? r.firstHireAtCustomers : r.firstHireAtCustomers + required * r.customersPerHire
    return { role: r.role, department: r.department, required, nextHireAtCustomers }
  })
}

// Total required headcount across all roles for a given customer count.
export function totalRequiredHeadcount(customers: number, rules: CapacityRule[] = CAPACITY_RULES): number {
  return capacityPlan(customers, rules).reduce((sum, n) => sum + n.required, 0)
}
