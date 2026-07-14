// Tenant exclusion rules for all customer metrics — internal/test/free/duplicate tenants must never
// pollute churn, activation, health, etc. Editable + auditable (stored via the assumptions store). Pure.

export interface ExclusionRules {
  internalEmailDomains: string[]     // tenants whose owner email is on these domains are internal
  testNamePatterns: string[]         // business_name substrings that mark test/demo tenants
  excludeFreePlans: boolean
  countSuspendedAsChurn: boolean     // accounting policy: is suspended == churned?
  countPausedAsChurn: boolean
}

export const DEFAULT_EXCLUSIONS: ExclusionRules = {
  internalEmailDomains: ['scalix26.com', 'scalix.ai', 'mylocksmithai.com'],
  testNamePatterns: ['zz_', 'zz-', '__test', 'demo tenant', 'e2e', 'verify'],
  excludeFreePlans: true,
  countSuspendedAsChurn: false,
  countPausedAsChurn: false,
}

export interface TenantLike {
  id: string
  business_name?: string | null
  email?: string | null
  plan?: string | null
}

// Why a tenant is excluded (or null if it counts). Returned so exclusions are explainable/auditable.
export function exclusionReason(t: TenantLike, r: ExclusionRules): string | null {
  const name = (t.business_name || '').toLowerCase()
  if (r.testNamePatterns.some((p) => name.includes(p.toLowerCase()))) return 'test/demo tenant'
  const domain = (t.email || '').split('@')[1]?.toLowerCase()
  if (domain && r.internalEmailDomains.includes(domain)) return 'internal tenant'
  if (r.excludeFreePlans && (!t.plan || t.plan === 'free')) return 'free / no plan'
  return null
}

export const isExcluded = (t: TenantLike, r: ExclusionRules): boolean => exclusionReason(t, r) != null
export const countable = <T extends TenantLike>(tenants: T[], r: ExclusionRules): T[] => tenants.filter((t) => !isExcluded(t, r))
