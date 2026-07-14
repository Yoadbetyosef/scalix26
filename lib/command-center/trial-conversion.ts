import type { Engine } from './adapters'

// Trial conversion — the real current bottleneck while 27/29 tenants are trials. A blank churn number must
// never hide this. Pure + tested. (Median-time-to-paid needs conversion timestamps we don't yet store →
// surfaced separately as Manual at the adapter layer.)

export interface TrialModel {
  isTrial: boolean
  converted: boolean // now on a paying plan / active subscription
  activated: boolean
  adopted: boolean
  expired: boolean // trial + long-inactive (per the configured rule)
  engine: Engine
}

export interface TrialConversion {
  started: number // all customers began on trial (early-stage assumption; caveated in UI)
  activeTrials: number
  activatedTrials: number
  adoptedTrials: number
  converted: number
  expired: number
  conversionRate: number
  activatedNotPaid: number
  adoptedNotPaid: number
  trialMrrOpportunityCents: number
  byEngine: Record<Engine, { started: number; converted: number; conversionRate: number }>
}

export function trialConversion(models: TrialModel[], opportunityPriceCents: number): TrialConversion {
  const started = models.length
  const trials = models.filter((m) => m.isTrial)
  const converted = models.filter((m) => m.converted).length
  const activeTrials = trials.filter((m) => !m.expired).length
  const activatedTrials = trials.filter((m) => m.activated).length
  const adoptedTrials = trials.filter((m) => m.adopted).length

  const engines: Engine[] = ['direct', 'affiliate', 'whiteLabel']
  const byEngine = Object.fromEntries(engines.map((e) => {
    const es = models.filter((m) => m.engine === e)
    const ec = es.filter((m) => m.converted).length
    return [e, { started: es.length, converted: ec, conversionRate: es.length > 0 ? ec / es.length : 0 }]
  })) as TrialConversion['byEngine']

  return {
    started, activeTrials, activatedTrials, adoptedTrials, converted,
    expired: trials.filter((m) => m.expired).length,
    conversionRate: started > 0 ? converted / started : 0,
    activatedNotPaid: trials.filter((m) => m.activated && !m.converted).length,
    adoptedNotPaid: trials.filter((m) => m.adopted && !m.converted).length,
    trialMrrOpportunityCents: activeTrials * opportunityPriceCents,
    byEngine,
  }
}
