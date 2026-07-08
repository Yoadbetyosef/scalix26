// ── Partner module entitlements (per-partner feature gating) ─────────────────────────────────
// The single source of truth for which Growth OS modules a partner sees. Mirrors the tenant module
// system (lib/modules.ts). ISOMORPHIC — no server imports — so the client sidebar, server layouts,
// and the admin API share one definition. A "partner type" is a PRESET over these modules, not a
// separate dashboard.

import type { PartnerType } from './roles'

export const PARTNER_MODULES = [
  { key: 'coach', label: 'AI Coach', description: 'AI business manager & next-best-actions' },
  { key: 'referrals', label: 'Referrals', description: 'Links, QR, sharing, tracking' },
  { key: 'customers', label: 'Customers', description: 'Referred businesses' },
  { key: 'crm', label: 'Pipeline', description: 'Sales CRM & pipeline' },
  { key: 'demos', label: 'Demos', description: 'AI demo generator + analytics' },
  { key: 'marketing', label: 'Marketing', description: 'Campaigns, creatives, assets, ROI' },
  { key: 'academy', label: 'Academy', description: 'Learning & certification' },
  { key: 'leaderboard', label: 'Leaderboard', description: 'Partner rankings' },
  { key: 'marketplace', label: 'Marketplace', description: 'Public partner profile' },
  { key: 'team', label: 'Team', description: 'Members & roles (agency/enterprise)' },
  { key: 'analytics', label: 'Analytics', description: 'Funnel, revenue, performance' },
  { key: 'implementation', label: 'Implementation', description: 'Setup projects & handoffs' },
] as const

export type PartnerModuleKey = (typeof PARTNER_MODULES)[number]['key']
export const ALL_PARTNER_MODULES: PartnerModuleKey[] = PARTNER_MODULES.map((m) => m.key)

// Always available regardless of module set (the spine of the portal).
export const CORE_PARTNER_ROUTES = ['/partner', '/partner/commissions', '/partner/settings'] as const

const SET = new Set<string>(ALL_PARTNER_MODULES)
export const isPartnerModule = (v: unknown): v is PartnerModuleKey => typeof v === 'string' && SET.has(v)
export const partnerModuleLabel = (k: PartnerModuleKey) => PARTNER_MODULES.find((m) => m.key === k)?.label ?? k

// ── Type presets: type → default enabled modules. Admin can toggle any module per partner. ──
export const PARTNER_TYPE_PRESETS: Record<PartnerType, PartnerModuleKey[]> = {
  affiliate: ['referrals', 'customers', 'academy', 'leaderboard'],
  creator: ['referrals', 'customers', 'marketing', 'analytics', 'academy', 'leaderboard'],
  growth: ['coach', 'referrals', 'customers', 'crm', 'demos', 'marketing', 'academy', 'leaderboard', 'marketplace', 'analytics'],
  agency: ['coach', 'referrals', 'customers', 'crm', 'demos', 'marketing', 'academy', 'leaderboard', 'marketplace', 'team', 'analytics'],
  technology: ['referrals', 'customers', 'demos', 'marketplace', 'implementation', 'analytics'],
  implementation: ['customers', 'implementation', 'marketplace', 'academy'],
  industry_expert: ['referrals', 'customers', 'marketing', 'marketplace', 'academy', 'analytics'],
  franchise: ['coach', 'referrals', 'customers', 'crm', 'demos', 'marketing', 'academy', 'leaderboard', 'marketplace', 'team', 'analytics'],
  white_label: ['coach', 'referrals', 'customers', 'crm', 'demos', 'marketing', 'academy', 'marketplace', 'team', 'analytics'],
  enterprise: ['coach', 'referrals', 'customers', 'crm', 'demos', 'marketing', 'academy', 'marketplace', 'team', 'analytics', 'implementation'],
  internal_rep: ['coach', 'referrals', 'customers', 'crm', 'demos', 'marketing', 'analytics'],
}

export const presetModulesFor = (t: PartnerType): PartnerModuleKey[] => PARTNER_TYPE_PRESETS[t] ?? PARTNER_TYPE_PRESETS.growth

type PartnerModuleSource = { enabled_modules?: string[] | null } | null | undefined

/**
 * A partner's enabled modules, sanitised. Backward-compatible: NULL/undefined means EVERYTHING is
 * enabled (partners created before this migration never lose features). An empty array is respected
 * (admin turned everything off).
 */
export function enabledPartnerModules(partner: PartnerModuleSource): PartnerModuleKey[] {
  const raw = partner?.enabled_modules
  if (raw === null || raw === undefined || !Array.isArray(raw)) return [...ALL_PARTNER_MODULES]
  return raw.filter(isPartnerModule)
}

export function partnerModuleEnabled(partner: PartnerModuleSource, key: PartnerModuleKey): boolean {
  return enabledPartnerModules(partner).includes(key)
}

// ── Route ↔ module map (longest-prefix wins) ──
const ROUTE_MODULE: { prefix: string; module: PartnerModuleKey }[] = [
  { prefix: '/partner/coach', module: 'coach' },
  { prefix: '/partner/referrals', module: 'referrals' },
  { prefix: '/partner/customers', module: 'customers' },
  { prefix: '/partner/pipeline', module: 'crm' },
  { prefix: '/partner/demos', module: 'demos' },
  { prefix: '/partner/marketing', module: 'marketing' },
  { prefix: '/partner/learning', module: 'academy' },
  { prefix: '/partner/leaderboard', module: 'leaderboard' },
  { prefix: '/partner/marketplace', module: 'marketplace' },
  { prefix: '/partner/team', module: 'team' },
  { prefix: '/partner/analytics', module: 'analytics' },
  { prefix: '/partner/implementation', module: 'implementation' },
]
ROUTE_MODULE.sort((a, b) => b.prefix.length - a.prefix.length) // longest-prefix wins

/** The module owning a path, or null for core/ungated routes (dashboard, commissions, settings). */
export function partnerModuleForPath(pathname: string): PartnerModuleKey | null {
  const clean = pathname.split('?')[0]
  return ROUTE_MODULE.find((r) => clean === r.prefix || clean.startsWith(r.prefix + '/'))?.module ?? null
}
