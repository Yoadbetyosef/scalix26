import type { CustomerModel } from './adapters'

// Growth Engines — the four engines with REALITY current output, TARGET, gap and required activity. Funnel
// steps are shown with a source: real where instrumented, "waiting" where no source exists yet (we never
// fabricate a funnel number). Backward-calc required activity is an Estimate. Pure + tested.

export type EngineKey = 'direct' | 'affiliate' | 'whiteLabel' | 'expansion'
export type StepSource = 'derived_actual' | 'manual' | 'waiting'
export interface FunnelStep { key: string; label: string; value: number | null; source: StepSource }

export interface EnginePlaybook { key: EngineKey; label: string; mission: string; funnelKeys: { key: string; label: string; instrumented: boolean }[]; bottleneckHint: string }

// Which funnel steps have a real source today vs need instrumentation (honest per the real schema).
export const ENGINE_PLAYBOOKS: Record<EngineKey, EnginePlaybook> = {
  direct: {
    key: 'direct', label: 'Direct Sales', mission: 'Acquire paying customers through outbound + inbound direct sales.',
    funnelKeys: [
      { key: 'outreach', label: 'Outreach sent', instrumented: false }, { key: 'conversations', label: 'Conversations', instrumented: false },
      { key: 'meetings', label: 'Meetings booked', instrumented: false }, { key: 'demos', label: 'Demos', instrumented: false },
      { key: 'trials', label: 'Active trials', instrumented: true }, { key: 'paying', label: 'Paying customers', instrumented: true },
    ], bottleneckHint: 'No outbound pipeline is instrumented yet — trial→paid is the only measured step.',
  },
  affiliate: {
    key: 'affiliate', label: 'Affiliate', mission: 'Recruit and activate affiliates who refer paying customers.',
    funnelKeys: [
      { key: 'recruited', label: 'Affiliates (active)', instrumented: true }, { key: 'clicks', label: 'Referral clicks', instrumented: false },
      { key: 'leads', label: 'Referred leads', instrumented: false }, { key: 'trials', label: 'Referred trials', instrumented: true },
      { key: 'paying', label: 'Referred paying', instrumented: true }, { key: 'productive', label: 'Productive affiliates', instrumented: true },
    ], bottleneckHint: 'No affiliate partners exist yet — recruitment is the first gap.',
  },
  whiteLabel: {
    key: 'whiteLabel', label: 'White Label', mission: 'Sign agencies that resell the platform to their own customers.',
    funnelKeys: [
      { key: 'agencies', label: 'Active agencies', instrumented: true }, { key: 'producing', label: 'Producing agencies', instrumented: true },
      { key: 'customers', label: 'Agency-sourced customers', instrumented: true }, { key: 'mrr', label: 'Agency-sourced MRR', instrumented: true },
      { key: 'sourced', label: 'Agencies sourced', instrumented: false }, { key: 'meetings', label: 'Agency meetings', instrumented: false },
    ], bottleneckHint: 'Agency count is small — sourcing/acquisition is not yet instrumented.',
  },
  expansion: {
    key: 'expansion', label: 'Expansion', mission: 'Grow revenue within existing customers (upgrades, add-ons, more usage).',
    funnelKeys: [
      { key: 'eligible', label: 'Eligible customers', instrumented: true }, { key: 'opportunities', label: 'Upgrade opportunities', instrumented: true },
      { key: 'offers', label: 'Offers sent', instrumented: false }, { key: 'accepted', label: 'Offers accepted', instrumented: false },
      { key: 'expansion_mrr', label: 'Expansion MRR', instrumented: false },
    ], bottleneckHint: 'Expansion offers are not tracked yet; opportunity groups are derived from usage.',
  },
}

export interface EngineCurrent { key: EngineKey; customers: number; mrrCents: number; activeTrials: number }

// Backward-calc: required net-new customers and monthly run-rate to hit a target by a horizon. Estimate.
export interface RequiredActivity { targetCustomers: number | null; gapCustomers: number | null; requiredMonthly: number | null }
export function requiredActivity(currentCustomers: number, targetCustomers: number | null, monthsToTarget: number | null): RequiredActivity {
  if (targetCustomers == null) return { targetCustomers: null, gapCustomers: null, requiredMonthly: null }
  const gap = Math.max(0, targetCustomers - currentCustomers)
  return { targetCustomers, gapCustomers: gap, requiredMonthly: monthsToTarget && monthsToTarget > 0 ? Math.ceil(gap / monthsToTarget) : null }
}

// Deterministic expansion opportunity groups from real customer models. No offers auto-sent.
export interface OpportunityGroup { key: string; label: string; count: number; potentialMrrCents: number; confidence: 'high' | 'medium' | 'low'; recommendedCampaign: string }
const STARTER = 29700, PRO_DELTA = 10000 // $100 upgrade delta (starter→pro/growth)
export function expansionGroups(models: CustomerModel[]): OpportunityGroup[] {
  const paying = models.filter((m) => m.converted && !m.isTrial)
  const adoptedLowPlan = paying.filter((m) => m.adopted && m.planPriceCents <= STARTER)
  const activatedNotAdopted = paying.filter((m) => m.activated && !m.adopted)
  const highActivityLowPlan = paying.filter((m) => m.outcomes30d >= 10 && m.planPriceCents <= STARTER)
  const groups: OpportunityGroup[] = [
    { key: 'adopted_low_plan', label: 'Adopted customers on a low plan', count: adoptedLowPlan.length, potentialMrrCents: adoptedLowPlan.length * PRO_DELTA, confidence: 'high', recommendedCampaign: 'Upgrade offer to a higher plan' },
    { key: 'activated_not_adopted', label: 'Activated but not yet deeply using', count: activatedNotAdopted.length, potentialMrrCents: 0, confidence: 'medium', recommendedCampaign: 'Adoption nudge → add a channel / AI employee' },
    { key: 'high_activity_low_plan', label: 'High usage on a low plan', count: highActivityLowPlan.length, potentialMrrCents: highActivityLowPlan.length * PRO_DELTA, confidence: 'high', recommendedCampaign: 'Usage-based upgrade offer' },
  ]
  return groups.filter((g) => g.count > 0)
}

export function buildFunnel(pb: EnginePlaybook, values: Record<string, number>): FunnelStep[] {
  return pb.funnelKeys.map((s) => ({ key: s.key, label: s.label, value: s.instrumented ? (values[s.key] ?? 0) : null, source: s.instrumented ? 'derived_actual' : 'waiting' }))
}
