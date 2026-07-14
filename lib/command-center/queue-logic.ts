// PURE onboarding-queue logic — no server imports, so it is safe to import into client components. The
// store (DB + audit) lives in onboarding-overlay.ts and re-exports these.

export type Engine = 'direct' | 'affiliate' | 'whiteLabel'
export const BLOCKERS = ['customer_unresponsive', 'phone_verification', 'twilio_approval', 'meta_approval', 'google_approval', 'missing_business_info', 'website_scan_failure', 'integration_failure', 'payment_issue', 'product_bug', 'internal_setup_delay', 'training_required', 'unknown'] as const
export const PRIORITIES = ['low', 'medium', 'high'] as const

export interface OnboardingOverlay {
  tenantId: string
  owner: string | null
  manualStage: string | null
  blocker: string | null
  blockerNotes: string | null
  slaDueDate: string | null
  priority: 'low' | 'medium' | 'high' | null
  nextAction: string | null
  followUpDate: string | null
  status: string | null
  resolutionNote: string | null
  updatedBy: string | null
  updatedAt: string | null
}
export type OverlayPatch = Partial<Omit<OnboardingOverlay, 'tenantId' | 'updatedBy' | 'updatedAt'>>
export const emptyOverlay = (tenantId: string): OnboardingOverlay => ({ tenantId, owner: null, manualStage: null, blocker: null, blockerNotes: null, slaDueDate: null, priority: null, nextAction: null, followUpDate: null, status: null, resolutionNote: null, updatedBy: null, updatedAt: null })

export interface OnboardingCase {
  tenantId: string; name: string; engine: Engine; observedStage: string
  daysInOnboarding: number; mrrCents: number; activated: boolean; overlay: OnboardingOverlay | null
}
export interface QueueFilters { stalled?: boolean; outsideSla?: boolean; highPriority?: boolean; unassigned?: boolean; blocker?: string; owner?: string; engine?: Engine }

const STALLED_DAYS = 7
export const isOutsideSla = (c: OnboardingCase, nowMs: number) => !!c.overlay?.slaDueDate && new Date(c.overlay.slaDueDate).getTime() < nowMs
export const isStalled = (c: OnboardingCase) => !c.activated && c.daysInOnboarding >= STALLED_DAYS

export function filterQueue(cases: OnboardingCase[], f: QueueFilters, nowMs: number): OnboardingCase[] {
  return cases.filter((c) => {
    if (f.stalled && !isStalled(c)) return false
    if (f.outsideSla && !isOutsideSla(c, nowMs)) return false
    if (f.highPriority && c.overlay?.priority !== 'high') return false
    if (f.unassigned && c.overlay?.owner) return false
    if (f.blocker && c.overlay?.blocker !== f.blocker) return false
    if (f.owner && c.overlay?.owner !== f.owner) return false
    if (f.engine && c.engine !== f.engine) return false
    return true
  })
}

// Sort: 1) outside SLA, 2) high-priority blocker, 3) highest MRR at risk, 4) longest time, 5) unassigned.
export function sortQueue(cases: OnboardingCase[], nowMs: number): OnboardingCase[] {
  const rank = (c: OnboardingCase) => [
    isOutsideSla(c, nowMs) ? 0 : 1,
    c.overlay?.priority === 'high' && c.overlay?.blocker ? 0 : 1,
    -c.mrrCents,
    -c.daysInOnboarding,
    c.overlay?.owner ? 1 : 0,
  ]
  return [...cases].sort((a, b) => {
    const ra = rank(a), rb = rank(b)
    for (let i = 0; i < ra.length; i++) if (ra[i] !== rb[i]) return ra[i] - rb[i]
    return 0
  })
}
