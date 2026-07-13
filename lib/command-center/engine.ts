import { type Cents, roundCents, applyRate, scaleCents } from './money'
import type { CommandCenterAssumptions, CustomerMix, Pricing, MonthForecast, ForecastResult } from './types'

// ── Pure sub-formulas (exported; pinned by the golden-case tests) ────────────────────────────────────

// Blended base subscription price for a plan mix (weighted by plan %).
export function blendedBasePriceCents(mix: CustomerMix, pricing: Pricing): Cents {
  return roundCents(
    mix.starterPct * pricing.starterCents + mix.growthPct * pricing.growthCents + mix.proPct * pricing.proCents,
  )
}

// Base subscription MRR = customers × blended base price.
export function baseSubscriptionMrrCents(customers: number, mix: CustomerMix, pricing: Pricing): Cents {
  return scaleCents(blendedBasePriceCents(mix, pricing), customers)
}

// Expansion MRR = eligible customers × adoption rate × avg add-ons × add-on price.
export function expansionMrrCents(customers: number, adoptionRate: number, avgAddOns: number, addOnCents: Cents): Cents {
  return scaleCents(addOnCents, customers * adoptionRate * avgAddOns)
}

// Affiliate commission = commissionable collected revenue × applicable rate.
export function affiliateCommissionCents(grossCents: Cents, rate: number): Cents {
  return applyRate(grossCents, rate)
}
export function affiliateNetCents(grossCents: Cents, rate: number): Cents {
  return grossCents - affiliateCommissionCents(grossCents, rate)
}

// Simulated valuation = ARR × multiple (a scenario estimate, never a guaranteed value).
export function valuationCents(arrCents: Cents, multiple: number): Cents {
  return roundCents(arrCents * multiple)
}

// ── The deterministic monthly forecast ──────────────────────────────────────────────────────────────

export function runForecast(a: CommandCenterAssumptions, months = 60): ForecastResult {
  const churn = a.retention.monthlyLogoChurn
  const blendedBase = blendedBasePriceCents(a.mix, a.pricing)

  // Fractional internal cohort state (integer reporting is derived per month).
  let direct = a.finance.startingCustomers // existing base folded into the direct cohort
  let affiliate = 0
  let whiteLabel = 0
  let activeAffiliates = 0
  let producingAgencies = 0
  let cash = a.finance.openingCashCents
  let prevGrossMrr = 0
  const ownHistory: number[] = [] // own (direct+affiliate) customers per month, for expansion delay

  const out: MonthForecast[] = []

  for (let m = 1; m <= months; m++) {
    const beginDirect = direct, beginAffiliate = affiliate, beginWL = whiteLabel
    const beginCustomers = beginDirect + beginAffiliate + beginWL

    // Direct funnel (outbound + paid + inbound).
    const d = a.direct
    const outboundMeetings = d.reps * d.emailsPerRepPerDay * d.workingDaysPerMonth * d.emailResponseRate * d.meetingBookRate * d.showRate
    const directAdds = outboundMeetings * d.closeRate
      + (d.paidCacCents > 0 ? d.paidBudgetCents / d.paidCacCents : 0)
      + (d.organicLeadsPerMonth + d.referralsPerMonth) * d.leadToCustomer

    // Affiliate engine.
    activeAffiliates = activeAffiliates * a.affiliate.activeRetention + a.affiliate.recruitedPerMonth * a.affiliate.activationRate
    const affiliateAdds = activeAffiliates * a.affiliate.customersPerActiveAffiliatePerMonth

    // White-label engine.
    producingAgencies = producingAgencies * (1 - a.whiteLabel.agencyChurn) + a.whiteLabel.agenciesPerMonth * a.whiteLabel.closeRate * a.whiteLabel.activationRate
    const whiteLabelAdds = producingAgencies * a.whiteLabel.customersPerAgencyPerMonth

    // Cohort churn + growth.
    direct = beginDirect * (1 - churn) + directAdds
    affiliate = beginAffiliate * (1 - churn) + affiliateAdds
    whiteLabel = beginWL * (1 - churn) + whiteLabelAdds
    const endCustomers = direct + affiliate + whiteLabel
    const churnedCustomers = beginCustomers * churn

    // Revenue.
    const ownCustomers = direct + affiliate
    const directMrr = scaleCents(blendedBase, direct)
    const affiliateGrossMrr = scaleCents(blendedBase, affiliate)
    const affiliateCommission = affiliateCommissionCents(affiliateGrossMrr, a.affiliate.commissionRate)
    const whiteLabelMrr = scaleCents(a.whiteLabel.platformFeeCentsPerClient, whiteLabel)
    const eligible = m - a.expansion.delayMonths >= 1 ? (ownHistory[m - a.expansion.delayMonths - 1] ?? 0) : 0
    const expansionMrr = expansionMrrCents(eligible, a.expansion.adoptionRate, a.expansion.avgAddOns, a.pricing.addOnCents)
    const grossMrr = directMrr + affiliateGrossMrr + whiteLabelMrr + expansionMrr
    const netMrr = grossMrr - affiliateCommission
    const arr = grossMrr * 12

    // Cost of revenue.
    const usageCost = scaleCents(a.cogs.usagePerCustomerCents, ownCustomers)
    const supportCost = scaleCents(a.cogs.supportPerCustomerCents, endCustomers) + scaleCents(a.whiteLabel.supportCostPerAgencyCents, producingAgencies)
    const stripeFees = applyRate(grossMrr, a.cogs.stripePct) + scaleCents(a.cogs.stripeFixedCents, ownCustomers)
    const cogs = usageCost + supportCost + stripeFees
    const grossProfit = grossMrr - cogs - affiliateCommission // commission classified as cost of revenue
    const grossMargin = grossMrr > 0 ? grossProfit / grossMrr : 0

    // OpEx & operating profit.
    const payroll = a.opex.payrollMonthlyCents
    const marketing = a.opex.marketingMonthlyCents + a.direct.paidBudgetCents
    const otherOpex = a.opex.otherOpexMonthlyCents
    const operatingProfit = grossProfit - payroll - marketing - otherOpex

    // Cash & runway.
    cash += operatingProfit
    const burn = operatingProfit < 0 ? -operatingProfit : 0
    const runwayMonths = burn > 0 ? (cash > 0 ? cash / burn : 0) : null

    // Unit economics.
    const totalAdds = directAdds + affiliateAdds + whiteLabelAdds
    const acquisitionSpend = marketing + affiliateCommission + scaleCents(a.affiliate.recruitCostCents, a.affiliate.recruitedPerMonth)
    const arpu = endCustomers > 0 ? roundCents(grossMrr / endCustomers) : 0
    const blendedCac = totalAdds > 0 ? roundCents(acquisitionSpend / totalAdds) : 0
    const ltv = churn > 0 ? roundCents((arpu * grossMargin) / churn) : 0
    const gpPerCust = arpu * grossMargin
    const cacPayback = gpPerCust > 0 ? blendedCac / gpPerCust : null
    const churnRev = applyRate(prevGrossMrr, churn)
    const nrr = prevGrossMrr > 0 ? (prevGrossMrr + expansionMrr - churnRev) / prevGrossMrr : 1

    out.push({
      month: m,
      beginCustomers: Math.round(beginCustomers),
      directAdds: Math.round(directAdds), affiliateAdds: Math.round(affiliateAdds), whiteLabelAdds: Math.round(whiteLabelAdds),
      churnedCustomers: Math.round(churnedCustomers), endCustomers: Math.round(endCustomers),
      directCustomers: Math.round(direct), affiliateCustomers: Math.round(affiliate), whiteLabelCustomers: Math.round(whiteLabel),
      activeAffiliates: Math.round(activeAffiliates), producingAgencies: Math.round(producingAgencies),
      directMrrCents: directMrr, affiliateGrossMrrCents: affiliateGrossMrr, affiliateCommissionCents: affiliateCommission,
      whiteLabelMrrCents: whiteLabelMrr, expansionMrrCents: expansionMrr, grossMrrCents: grossMrr, netMrrCents: netMrr, arrCents: arr,
      cogsCents: cogs, grossProfitCents: grossProfit, grossMargin,
      payrollCents: payroll, marketingCents: marketing, otherOpexCents: otherOpex, operatingProfitCents: operatingProfit,
      endingCashCents: cash, runwayMonths,
      arpuCents: arpu, blendedCacCents: blendedCac, ltvCents: ltv, cacPaybackMonths: cacPayback, nrr,
      valuationCents: valuationCents(arr, a.valuation.arrMultiple),
    })

    ownHistory.push(ownCustomers)
    prevGrossMrr = grossMrr
  }

  return { months: out, assumptions: a }
}
