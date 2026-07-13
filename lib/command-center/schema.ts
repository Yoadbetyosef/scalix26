// 'cents' = integer cents, 'pct' = fraction (0.20), 'int'/'number' = plain counts/rates.
export type AssumptionType = 'cents' | 'pct' | 'int' | 'number'

// Assumption registry — the SINGLE source of truth for every editable assumption: its DB identity
// (category/key), UI metadata (section/label/unit), value type, and its path into the typed
// CommandCenterAssumptions object. The editor, the resolver (rows → typed object), default seeding, and
// validation all read from here, so they can never drift.

export interface AssumptionDef {
  section: string // UI grouping
  category: string // DB category (= first path segment)
  key: string // DB key (= second path segment)
  label: string
  unit: string
  type: AssumptionType
  path: string // dot-path into CommandCenterAssumptions (exactly two segments)
}

function def(section: string, path: string, label: string, unit: string, type: AssumptionType): AssumptionDef {
  const [category, key] = path.split('.')
  return { section, category, key, label, unit, type, path }
}

export const ASSUMPTION_REGISTRY: AssumptionDef[] = [
  // A. Product pricing
  def('Product Pricing', 'pricing.starterCents', 'Starter plan', '$/mo', 'cents'),
  def('Product Pricing', 'pricing.growthCents', 'Growth plan', '$/mo', 'cents'),
  def('Product Pricing', 'pricing.proCents', 'Pro plan', '$/mo', 'cents'),
  def('Product Pricing', 'pricing.addOnCents', 'Add-on (AI employee / phone / location)', '$/mo', 'cents'),
  def('Product Pricing', 'pricing.setupFeeCents', 'Setup fee', '$', 'cents'),
  // B. Customer mix
  def('Customer Mix', 'mix.starterPct', 'On Starter', '%', 'pct'),
  def('Customer Mix', 'mix.growthPct', 'On Growth', '%', 'pct'),
  def('Customer Mix', 'mix.proPct', 'On Pro', '%', 'pct'),
  def('Customer Mix', 'addOns.adoptionRate', 'Add-on adoption', '%', 'pct'),
  def('Customer Mix', 'addOns.avgAddOns', 'Avg add-ons / customer', '#', 'number'),
  // C. Retention
  def('Retention', 'retention.monthlyLogoChurn', 'Monthly logo churn', '%', 'pct'),
  // D. Direct sales engine
  def('Direct Sales', 'direct.reps', 'Sales reps', '#', 'int'),
  def('Direct Sales', 'direct.emailsPerRepPerDay', 'Emails / rep / day', '#', 'int'),
  def('Direct Sales', 'direct.workingDaysPerMonth', 'Working days / month', '#', 'int'),
  def('Direct Sales', 'direct.emailResponseRate', 'Email response rate', '%', 'pct'),
  def('Direct Sales', 'direct.meetingBookRate', 'Meeting-book rate', '%', 'pct'),
  def('Direct Sales', 'direct.showRate', 'Show rate', '%', 'pct'),
  def('Direct Sales', 'direct.closeRate', 'Close rate', '%', 'pct'),
  def('Direct Sales', 'direct.paidBudgetCents', 'Paid-ad budget', '$/mo', 'cents'),
  def('Direct Sales', 'direct.paidCacCents', 'Paid CAC', '$', 'cents'),
  def('Direct Sales', 'direct.organicLeadsPerMonth', 'Organic leads / mo', '#', 'int'),
  def('Direct Sales', 'direct.referralsPerMonth', 'Referrals / mo', '#', 'int'),
  def('Direct Sales', 'direct.leadToCustomer', 'Lead → customer', '%', 'pct'),
  // E. Affiliate engine
  def('Affiliate', 'affiliate.recruitedPerMonth', 'Affiliates recruited / mo', '#', 'int'),
  def('Affiliate', 'affiliate.activationRate', 'Activation rate', '%', 'pct'),
  def('Affiliate', 'affiliate.activeRetention', 'Active-affiliate retention', '%', 'pct'),
  def('Affiliate', 'affiliate.customersPerActiveAffiliatePerMonth', 'Customers / active affiliate / mo', '#', 'number'),
  def('Affiliate', 'affiliate.commissionRate', 'Recurring commission', '%', 'pct'),
  def('Affiliate', 'affiliate.recruitCostCents', 'Recruitment cost / affiliate', '$', 'cents'),
  // F. White label engine
  def('White Label', 'whiteLabel.agenciesPerMonth', 'Agencies recruited / mo', '#', 'number'),
  def('White Label', 'whiteLabel.closeRate', 'Agency close rate', '%', 'pct'),
  def('White Label', 'whiteLabel.activationRate', 'Agency activation rate', '%', 'pct'),
  def('White Label', 'whiteLabel.agencyChurn', 'Agency churn / mo', '%', 'pct'),
  def('White Label', 'whiteLabel.customersPerAgencyPerMonth', 'Customers / agency / mo', '#', 'number'),
  def('White Label', 'whiteLabel.platformFeeCentsPerClient', 'Platform fee / client', '$/mo', 'cents'),
  def('White Label', 'whiteLabel.supportCostPerAgencyCents', 'Support cost / agency', '$/mo', 'cents'),
  // G. Expansion engine
  def('Expansion', 'expansion.adoptionRate', 'Add-on adoption', '%', 'pct'),
  def('Expansion', 'expansion.avgAddOns', 'Avg add-ons', '#', 'number'),
  def('Expansion', 'expansion.delayMonths', 'Expansion delay', 'months', 'int'),
  // H. Cost of revenue
  def('Cost of Revenue', 'cogs.usagePerCustomerCents', 'Usage / customer', '$/mo', 'cents'),
  def('Cost of Revenue', 'cogs.supportPerCustomerCents', 'Support / customer', '$/mo', 'cents'),
  def('Cost of Revenue', 'cogs.stripePct', 'Stripe processing', '%', 'pct'),
  def('Cost of Revenue', 'cogs.stripeFixedCents', 'Stripe fixed fee', '$', 'cents'),
  // I. Operating expenses
  def('Operating Expenses', 'opex.payrollMonthlyCents', 'Payroll', '$/mo', 'cents'),
  def('Operating Expenses', 'opex.marketingMonthlyCents', 'Marketing', '$/mo', 'cents'),
  def('Operating Expenses', 'opex.otherOpexMonthlyCents', 'Other opex', '$/mo', 'cents'),
  // J. Financing & cash
  def('Financing & Cash', 'finance.openingCashCents', 'Opening cash', '$', 'cents'),
  def('Financing & Cash', 'finance.startingCustomers', 'Starting customers', '#', 'int'),
  // K. Valuation & targets
  def('Valuation & Targets', 'valuation.arrMultiple', 'ARR multiple', '×', 'number'),
  def('Valuation & Targets', 'targets.targetArrCents', 'Target ARR', '$', 'cents'),
  def('Valuation & Targets', 'targets.targetValuationCents', 'Target valuation', '$', 'cents'),
]

export const REGISTRY_BY_ID: Record<string, AssumptionDef> = Object.fromEntries(
  ASSUMPTION_REGISTRY.map((d) => [`${d.category}.${d.key}`, d]),
)
export const SECTIONS: string[] = [...new Set(ASSUMPTION_REGISTRY.map((d) => d.section))]
