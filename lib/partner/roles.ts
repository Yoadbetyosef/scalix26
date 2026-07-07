// Isomorphic partner types + capability model. NO server imports — safe in client components.
// Server-only context resolution lives in lib/partner/rbac.ts.

export type PartnerType = 'affiliate' | 'growth' | 'agency' | 'enterprise' | 'internal_rep'
export type PartnerRole = 'owner' | 'manager' | 'sales' | 'marketing' | 'finance' | 'support'

export const PARTNER_TYPES: { key: PartnerType; label: string }[] = [
  { key: 'affiliate', label: 'Affiliate' },
  { key: 'growth', label: 'Growth Partner' },
  { key: 'agency', label: 'Agency' },
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
  /** True when this identity arrived via an API key rather than a browser session. */
  viaApiKey?: boolean
  /** Scopes granted to the API key, when viaApiKey. */
  scopes?: string[]
}

// ── Capability model ────────────────────────────────────────────────────────
const TEAM_TYPES: PartnerType[] = ['agency', 'enterprise']

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

export const canWhiteLabel = (c: PartnerContext) => c.partnerType === 'agency' || c.partnerType === 'enterprise'

/** Whether a write API key scope is present (API-key auth), else session write is allowed. */
export const canWriteVia = (c: PartnerContext) => !c.viaApiKey || (c.scopes?.includes('write') ?? false)
