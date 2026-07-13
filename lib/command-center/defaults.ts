import { toCents } from './money'
import type { CommandCenterAssumptions } from './types'

// The BASE operating plan — sensible, transparent defaults. Editable in Phase 2 (assumption drawer); the
// engine NEVER hard-codes these (it reads a resolved assumption object). Money via toCents so there is no
// floating-point currency literal.
//
// Pricing = the founder's stated plan set. Affiliate commission = the ACTIVE seeded commission plan
// ("Growth Ladder — 30–40% recurring", base 30%) → 0.30 effective for the Base scenario; tiered rates and
// the per-plan commission_plan lookup arrive in Phase 2. White-label revenue uses the $97 platform fee
// (Phase 7), configured SEPARATELY from the affiliate model.

export const BASE_ASSUMPTIONS: CommandCenterAssumptions = {
  pricing: {
    starterCents: toCents(297),
    growthCents: toCents(397),
    proCents: toCents(597),
    addOnCents: toCents(97),
    setupFeeCents: toCents(0),
  },
  mix: { starterPct: 0.3, growthPct: 0.5, proPct: 0.2 }, // sums to 1.0
  addOns: { adoptionRate: 0.4, avgAddOns: 0.6 },
  retention: { monthlyLogoChurn: 0.03 },
  direct: {
    reps: 2,
    emailsPerRepPerDay: 100,
    workingDaysPerMonth: 21,
    emailResponseRate: 0.02,
    meetingBookRate: 0.3,
    showRate: 0.7,
    closeRate: 0.25,
    paidBudgetCents: toCents(10000),
    paidCacCents: toCents(600),
    organicLeadsPerMonth: 40,
    referralsPerMonth: 10,
    leadToCustomer: 0.08,
  },
  affiliate: {
    recruitedPerMonth: 20,
    activationRate: 0.35,
    activeRetention: 0.9,
    customersPerActiveAffiliatePerMonth: 1.2,
    commissionRate: 0.3, // active seeded commission_plan base rate
    recruitCostCents: toCents(50),
  },
  whiteLabel: {
    agenciesPerMonth: 4,
    closeRate: 0.4,
    activationRate: 0.7,
    agencyChurn: 0.03,
    customersPerAgencyPerMonth: 3,
    platformFeeCentsPerClient: toCents(97),
    supportCostPerAgencyCents: toCents(150),
  },
  expansion: { adoptionRate: 0.4, avgAddOns: 0.6, delayMonths: 2 },
  cogs: {
    usagePerCustomerCents: toCents(35),
    supportPerCustomerCents: toCents(12),
    stripePct: 0.029,
    stripeFixedCents: toCents(0.3),
  },
  opex: {
    payrollMonthlyCents: toCents(60000),
    marketingMonthlyCents: toCents(8000),
    otherOpexMonthlyCents: toCents(12000),
  },
  finance: { openingCashCents: toCents(500000), startingCustomers: 0 },
  valuation: { arrMultiple: 10 },
  targets: { targetArrCents: toCents(100_000_000), targetValuationCents: toCents(1_000_000_000) },
}

// Plan-mix MUST total 100%. Returns the error string (or null when valid) — surfaced in the UI/tests.
export function validatePlanMix(mix: { starterPct: number; growthPct: number; proPct: number }): string | null {
  const total = mix.starterPct + mix.growthPct + mix.proPct
  if (Math.abs(total - 1) > 1e-6) return `Plan mix must total 100% (currently ${(total * 100).toFixed(1)}%)`
  return null
}
