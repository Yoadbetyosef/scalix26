// Isomorphic partner types + capability model. NO server imports — safe in client components.
// Server-only context resolution lives in lib/partner/rbac.ts.

export type PartnerType =
  | 'affiliate' | 'creator' | 'growth' | 'agency' | 'technology' | 'implementation'
  | 'industry_expert' | 'franchise' | 'white_label' | 'enterprise' | 'internal_rep'
export type PartnerRole = 'owner' | 'manager' | 'sales' | 'marketing' | 'finance' | 'support'

export const PARTNER_TYPES: { key: PartnerType; label: string }[] = [
  { key: 'affiliate', label: 'Affiliate' },
  { key: 'creator', label: 'Content Creator' },
  { key: 'growth', label: 'Growth Partner' },
  { key: 'agency', label: 'Agency' },
  { key: 'technology', label: 'Technology Partner' },
  { key: 'implementation', label: 'Implementation Partner' },
  { key: 'industry_expert', label: 'Industry Expert' },
  { key: 'franchise', label: 'Franchise / Network' },
  { key: 'white_label', label: 'White Label' },
  { key: 'enterprise', label: 'Enterprise Partner' },
  { key: 'internal_rep', label: 'Internal Sales Rep' },
]

export const PARTNER_ROLES: { key: PartnerRole; label: string }[] = [
  { key: 'owner', label: 'Owner' },
  { key: 'manager', label: 'Manager' },
  { key: 'sales', label: 'Sales' },
  { key: 'marketing', label: 'Marketing' },
  { key: 'finance', label: 'Finance' },
  { key: 'support', label: 'Support' },
]

export interface PartnerContext {
  userId: string
  partnerId: string
  partnerType: PartnerType
  role: PartnerRole
  status: string
  companyName: string | null
  slug: string
  /** The partner's raw enabled_modules column (null = all modules; see lib/partner/modules.ts). */
  enabledModulesRaw?: string[] | null
  /** True when this identity arrived via an API key rather than a browser session. */
  viaApiKey?: boolean
  /** Scopes granted to the API key, when viaApiKey. */
  scopes?: string[]
}

// ── Capability model ────────────────────────────────────────────────────────
const TEAM_TYPES: PartnerType[] = ['agency', 'enterprise', 'franchise', 'white_label']

/** Only agencies/enterprise partners get multi-seat team management. */
export const supportsTeams = (t: PartnerType) => TEAM_TYPES.includes(t)

export const canManageTeam = (c: PartnerContext) =>
  supportsTeams(c.partnerType) && (c.role === 'owner' || c.role === 'manager')

export const canManageApiKeys = (c: PartnerContext) =>
  (c.role === 'owner' || c.role === 'manager') && c.partnerType !== 'affiliate'

export const canEditPipeline = (c: PartnerContext) => ['owner', 'manager', 'sales'].includes(c.role)
export const canViewPipeline = (c: PartnerContext) => c.role !== 'finance'
export const canCreateDemos = (c: PartnerContext) => ['owner', 'manager', 'sales', 'marketing'].includes(c.role)
export const canViewFinance = (c: PartnerContext) => ['owner', 'manager', 'finance'].includes(c.role)
export const canManageBilling = (c: PartnerContext) => c.role === 'owner' || c.role === 'finance'

export const canEditMarketplace = (c: PartnerContext) =>
  supportsTeams(c.partnerType)
    ? ['owner', 'manager', 'marketing'].includes(c.role)
    : c.partnerType !== 'affiliate' && c.partnerType !== 'internal_rep'

export const canWhiteLabel = (c: PartnerContext) => c.partnerType === 'white_label' || c.partnerType === 'enterprise'

/** Whether a write API key scope is present (API-key auth), else session write is allowed. */
export const canWriteVia = (c: PartnerContext) => !c.viaApiKey || (c.scopes?.includes('write') ?? false)
