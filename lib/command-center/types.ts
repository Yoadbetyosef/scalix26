import type { Cents } from './money'

// ── Assumptions (the Base operating plan). Grouped by section. Money = integer cents; rates = fractions.
// Phase 1 wires the CORE drivers of every North Star metric; Phase 2 expands editable coverage (full
// funnel, per-role headcount, per-line COGS) — the DB assumption rows (category/key) resolve INTO this
// typed object, so the engine only ever reads a resolved CommandCenterAssumptions.

export interface Pricing {
  starterCents: Cents
  growthCents: Cents
  proCents: Cents
  addOnCents: Cents // per additional AI employee / phone / location / channel
  setupFeeCents: Cents
}

export interface CustomerMix {
  starterPct: number // fractions; validated to sum to 1 across the three plans
  growthPct: number
  proPct: number
}

export interface AddOns {
  adoptionRate: number // fraction of customers with >=1 add-on
  avgAddOns: number // average add-ons among all customers
}

export interface Retention {
  monthlyLogoChurn: number // fraction of customers lost per month
}

// Direct-sales funnel (outbound + paid + organic). Produces new direct customers per month.
export interface DirectEngine {
  reps: number
  emailsPerRepPerDay: number
  workingDaysPerMonth: number
  emailResponseRate: number
  meetingBookRate: number // of responders
  showRate: number
  closeRate: number
  paidBudgetCents: Cents
  paidCacCents: Cents
  organicLeadsPerMonth: number
  referralsPerMonth: number
  leadToCustomer: number // conversion of organic/referral leads
}

export interface AffiliateEngine {
  recruitedPerMonth: number
  activationRate: number // recruited → activated (first sale)
  activeRetention: number // month-over-month retention of active affiliates
  customersPerActiveAffiliatePerMonth: number
  commissionRate: number // effective recurring commission (from the active commission_plan)
  recruitCostCents: Cents // per recruited affiliate
}

export interface WhiteLabelEngine {
  agenciesPerMonth: number
  closeRate: number
  activationRate: number
  agencyChurn: number // monthly
  customersPerAgencyPerMonth: number
  platformFeeCentsPerClient: Cents // Scalix revenue per WL end-client (the $97 platform fee)
  supportCostPerAgencyCents: Cents
}

export interface Expansion {
  adoptionRate: number
  avgAddOns: number
  delayMonths: number // customers become expansion-eligible after this many months
}

export interface CostOfRevenue {
  usagePerCustomerCents: Cents // telephony + messaging + AI inference + voice, per customer/month
  supportPerCustomerCents: Cents
  stripePct: number // processing fraction of collected revenue
  stripeFixedCents: Cents // per paying customer
}

export interface OperatingExpenses {
  payrollMonthlyCents: Cents // Phase 1: aggregate; Phase 2: derived from cc_headcount
  marketingMonthlyCents: Cents // non-paid-ad marketing/opex
  otherOpexMonthlyCents: Cents // legal/accounting/software/office/etc.
}

export interface Finance {
  openingCashCents: Cents
  startingCustomers: number // month-0 customer base the forecast grows from
}

export interface Valuation {
  arrMultiple: number
}

export interface Targets {
  targetArrCents: Cents
  targetValuationCents: Cents
}

export interface CommandCenterAssumptions {
  pricing: Pricing
  mix: CustomerMix
  addOns: AddOns
  retention: Retention
  direct: DirectEngine
  affiliate: AffiliateEngine
  whiteLabel: WhiteLabelEngine
  expansion: Expansion
  cogs: CostOfRevenue
  opex: OperatingExpenses
  finance: Finance
  valuation: Valuation
  targets: Targets
}

// ── Forecast output ────────────────────────────────────────────────────────────────────────────────
export type EngineKey = 'direct' | 'affiliate' | 'whiteLabel' | 'expansion'
export type Health = 'green' | 'yellow' | 'red'

export interface MonthForecast {
  month: number // 1..N
  // customers
  beginCustomers: number
  directAdds: number
  affiliateAdds: number
  whiteLabelAdds: number
  churnedCustomers: number
  endCustomers: number
  directCustomers: number
  affiliateCustomers: number
  whiteLabelCustomers: number
  activeAffiliates: number
  producingAgencies: number
  // revenue (cents)
  directMrrCents: Cents
  affiliateGrossMrrCents: Cents
  affiliateCommissionCents: Cents
  whiteLabelMrrCents: Cents
  expansionMrrCents: Cents
  grossMrrCents: Cents
  netMrrCents: Cents
  arrCents: Cents
  // cost & profit (cents)
  cogsCents: Cents
  grossProfitCents: Cents
  grossMargin: number
  payrollCents: Cents
  marketingCents: Cents
  otherOpexCents: Cents
  operatingProfitCents: Cents
  endingCashCents: Cents
  runwayMonths: number | null // null = profitable / infinite runway
  // unit economics
  arpuCents: Cents
  blendedCacCents: Cents
  ltvCents: Cents
  cacPaybackMonths: number | null
  nrr: number
  // valuation
  valuationCents: Cents
}

export interface ForecastResult {
  months: MonthForecast[]
  assumptions: CommandCenterAssumptions
}
