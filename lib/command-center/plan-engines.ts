// Per-engine backward calculation. Given a required number of new customers for a period, split it by the
// EDITABLE growth-engine allocation and work backward through each engine's real funnel to the raw activity
// (outreach, demos, recruits, agency meetings, expansion offers). Every rate comes from the persisted
// assumptions; if a required rate is missing/zero the funnel is null → the UI shows "Input Required".
// Pure + tested. Nothing hardcoded; nothing invented.

export type Engine = 'direct' | 'affiliate' | 'whiteLabel' | 'expansion'
export interface EngineAllocation { direct: number; affiliate: number; whiteLabel: number; expansion: number }

export interface DirectRates { closeRate: number; showRate: number; bookRate: number; responseRate: number }
export interface AffiliateRates { customersPerActiveAffiliate: number; activationRate: number }
export interface WhiteLabelRates { customersPerAgency: number; launchRate: number; closeRate: number }
export interface ExpansionRates { adoptionRate: number; avgAddOns: number; addOnCents: number }
export interface EngineRates { direct: DirectRates; affiliate: AffiliateRates; whiteLabel: WhiteLabelRates; expansion: ExpansionRates; arpuCents: number }

export interface DirectFunnel { customers: number; demos: number; meetings: number; conversations: number; outreach: number }
export interface AffiliateFunnel { customers: number; productiveAffiliates: number; recruitedAffiliates: number }
export interface WhiteLabelFunnel { customers: number; agencies: number; signedAgencies: number; meetings: number; outreach: number }
export interface ExpansionFunnel { mrrCents: number; eligible: number; offers: number; conversations: number }

const ok = (...ns: number[]) => ns.every((n) => n > 0)

export function directFunnel(customers: number, r: DirectRates): DirectFunnel | null {
  if (!ok(r.closeRate, r.showRate, r.bookRate, r.responseRate)) return null
  const demos = Math.ceil(customers / r.closeRate)
  const meetings = Math.ceil(demos / r.showRate)
  const conversations = Math.ceil(meetings / r.bookRate)
  const outreach = Math.ceil(conversations / r.responseRate)
  return { customers, demos, meetings, conversations, outreach }
}
export function affiliateFunnel(customers: number, r: AffiliateRates): AffiliateFunnel | null {
  if (!ok(r.customersPerActiveAffiliate, r.activationRate)) return null
  const productive = Math.ceil(customers / r.customersPerActiveAffiliate)
  const recruited = Math.ceil(productive / r.activationRate)
  return { customers, productiveAffiliates: productive, recruitedAffiliates: recruited }
}
export function whiteLabelFunnel(customers: number, r: WhiteLabelRates): WhiteLabelFunnel | null {
  if (!ok(r.customersPerAgency, r.launchRate, r.closeRate)) return null
  const agencies = Math.ceil(customers / r.customersPerAgency)
  const signed = Math.ceil(agencies / r.launchRate)
  const meetings = Math.ceil(signed / r.closeRate)
  return { customers, agencies, signedAgencies: signed, meetings, outreach: meetings }
}
export function expansionFunnel(mrrCents: number, r: ExpansionRates): ExpansionFunnel | null {
  if (!ok(r.adoptionRate, r.avgAddOns, r.addOnCents)) return null
  const perOffer = r.adoptionRate * r.avgAddOns * r.addOnCents
  if (perOffer <= 0) return null
  const eligible = Math.ceil(mrrCents / perOffer)
  return { mrrCents, eligible, offers: eligible, conversations: eligible }
}

export interface EnginePlans {
  direct: { customers: number; funnel: DirectFunnel | null }
  affiliate: { customers: number; funnel: AffiliateFunnel | null }
  whiteLabel: { customers: number; funnel: WhiteLabelFunnel | null }
  expansion: { mrrCents: number; funnel: ExpansionFunnel | null }
}

const normalize = (a: EngineAllocation): EngineAllocation => {
  const sum = a.direct + a.affiliate + a.whiteLabel + a.expansion
  if (sum <= 0) return { direct: 1, affiliate: 0, whiteLabel: 0, expansion: 0 }
  return { direct: a.direct / sum, affiliate: a.affiliate / sum, whiteLabel: a.whiteLabel / sum, expansion: a.expansion / sum }
}

// Split a period's net-new customer requirement by allocation and back-calc each engine. Expansion's share is
// delivered as MRR (share × customers × ARPU) rather than new logos.
export function enginePlans(netNewCustomers: number, rates: EngineRates, allocation: EngineAllocation): EnginePlans {
  const a = normalize(allocation)
  const dc = Math.ceil(netNewCustomers * a.direct)
  const ac = Math.ceil(netNewCustomers * a.affiliate)
  const wc = Math.ceil(netNewCustomers * a.whiteLabel)
  const expMrr = Math.round(netNewCustomers * a.expansion * rates.arpuCents)
  return {
    direct: { customers: dc, funnel: directFunnel(dc, rates.direct) },
    affiliate: { customers: ac, funnel: affiliateFunnel(ac, rates.affiliate) },
    whiteLabel: { customers: wc, funnel: whiteLabelFunnel(wc, rates.whiteLabel) },
    expansion: { mrrCents: expMrr, funnel: expansionFunnel(expMrr, rates.expansion) },
  }
}
