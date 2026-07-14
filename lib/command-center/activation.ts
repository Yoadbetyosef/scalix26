// Setup Complete / Technically Live / Activated / Adopted — four DISTINCT states, from real product
// behavior (never "logged in"). Rules are editable (Settings). Pure + tested.

export type ValueEventType = 'lead' | 'appointment' | 'ai_resolved_conversation' | 'workflow_outcome'

export interface ActivationRules {
  qualifyingEvents: ValueEventType[]
  adoptionMinEvents: number       // default 3
  adoptionMinDistinctDays: number // default 2
  adoptionWindowDays: number      // default 30
}
export const DEFAULT_ACTIVATION_RULES: ActivationRules = {
  qualifyingEvents: ['lead', 'appointment', 'ai_resolved_conversation', 'workflow_outcome'],
  adoptionMinEvents: 3, adoptionMinDistinctDays: 2, adoptionWindowDays: 30,
}

export interface ValueEvent { type: ValueEventType; at: string } // at = ISO timestamp

export interface CustomerSignals {
  requiredOnboardingComplete: boolean // Setup Complete
  liveChannels: number                // operational customer-facing channels → Technically Live
  valueEvents: ValueEvent[]           // real business-value events
}

export interface ActivationStatus {
  setupComplete: boolean
  technicallyLive: boolean
  activated: boolean
  adopted: boolean
  firstValueAt: string | null
}

export function activationStatus(s: CustomerSignals, r: ActivationRules = DEFAULT_ACTIVATION_RULES): ActivationStatus {
  const qualifying = s.valueEvents
    .filter((e) => r.qualifyingEvents.includes(e.type))
    .map((e) => new Date(e.at).getTime())
    .filter((t) => Number.isFinite(t))
    .sort((a, b) => a - b)

  const activated = qualifying.length > 0
  const firstValueAt = activated ? new Date(qualifying[0]).toISOString() : null

  // Adopted: >= minEvents across >= minDistinctDays within any adoptionWindowDays window.
  let adopted = false
  const windowMs = r.adoptionWindowDays * 86_400_000
  for (let i = 0; i < qualifying.length && !adopted; i++) {
    const inWindow = qualifying.filter((t) => t >= qualifying[i] && t <= qualifying[i] + windowMs)
    if (inWindow.length >= r.adoptionMinEvents) {
      const days = new Set(inWindow.map((t) => Math.floor(t / 86_400_000)))
      if (days.size >= r.adoptionMinDistinctDays) adopted = true
    }
  }

  return { setupComplete: s.requiredOnboardingComplete, technicallyLive: s.liveChannels > 0, activated, adopted, firstValueAt }
}

export function activationRate(customers: { activated: boolean }[]): number {
  return customers.length > 0 ? customers.filter((c) => c.activated).length / customers.length : 0
}
