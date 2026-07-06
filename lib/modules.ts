// ── Module entitlements (per-tenant feature gating) ──────────────────────────────────
// A single source of truth for which product modules a business has enabled. Platform
// admins toggle these per tenant in /admin/modules; the app (navigation, routes, dashboard
// widgets, AI tools) reads `enabled_modules` off the tenant and hides anything disabled.
//
// This file is ISOMORPHIC (no server-only imports) so the client sidebar, server layouts,
// the admin API, and the AI pipeline can all share the exact same definitions.

export const MODULES = [
  { key: 'ai_voice', label: 'AI Voice', description: 'AI employees, live voice, test AI' },
  { key: 'inbox', label: 'Inbox', description: 'Unified conversations' },
  { key: 'contacts', label: 'Contacts', description: 'Customer directory' },
  { key: 'inventory', label: 'Inventory', description: 'Stock & parts' },
  { key: 'pipeline', label: 'Pipeline', description: 'Leads & deal stages' },
  { key: 'scheduling', label: 'Scheduling', description: 'Appointments & availability' },
  { key: 'estimates', label: 'Estimates', description: 'Quotes & estimate requests' },
] as const

export type ModuleKey = (typeof MODULES)[number]['key']

export const ALL_MODULES: ModuleKey[] = MODULES.map((m) => m.key)

const MODULE_SET = new Set<string>(ALL_MODULES)
export const isModuleKey = (v: unknown): v is ModuleKey => typeof v === 'string' && MODULE_SET.has(v)

export const moduleLabel = (key: ModuleKey): string => MODULES.find((m) => m.key === key)?.label ?? key

type TenantModules = { enabled_modules?: string[] | null } | null | undefined

/**
 * The tenant's enabled modules, sanitised. Backward-compatible: a null/undefined column
 * (a tenant created before the migration) means EVERYTHING is enabled, so existing
 * businesses never silently lose features. An empty array means the admin turned
 * everything off — that is respected.
 */
export function enabledModulesOf(tenant: TenantModules): ModuleKey[] {
  const raw = tenant?.enabled_modules
  if (raw === null || raw === undefined || !Array.isArray(raw)) return [...ALL_MODULES]
  return raw.filter(isModuleKey)
}

export function moduleEnabled(tenant: TenantModules, key: ModuleKey): boolean {
  return enabledModulesOf(tenant).includes(key)
}

// ── Route ↔ module map ────────────────────────────────────────────────────────────────
// Longest-prefix wins so `/settings/availability` (scheduling) is not shadowed by `/settings`.
const ROUTE_MODULE: { prefix: string; module: ModuleKey }[] = [
  { prefix: '/settings/availability', module: 'scheduling' },
  { prefix: '/inbox', module: 'inbox' },
  { prefix: '/contacts', module: 'contacts' },
  { prefix: '/ai-employees', module: 'ai_voice' },
  { prefix: '/test-ai', module: 'ai_voice' },
  { prefix: '/inventory', module: 'inventory' },
  { prefix: '/pipeline', module: 'pipeline' },
  { prefix: '/estimates', module: 'estimates' },
]

/** The module a pathname belongs to, or null for always-available routes (dashboard, settings…). */
export function moduleForPath(pathname: string): ModuleKey | null {
  const hit = ROUTE_MODULE
    .slice()
    .sort((a, b) => b.prefix.length - a.prefix.length)
    .find((r) => pathname === r.prefix || pathname.startsWith(r.prefix + '/'))
  return hit?.module ?? null
}

/** The module a sidebar nav item (its href) belongs to, or null if it should always show. */
export function moduleForNav(href: string): ModuleKey | null {
  if (href.startsWith('/dashboard?tab=leads')) return 'pipeline'
  // strip any query/hash before matching a path prefix
  const path = href.split(/[?#]/)[0]
  return moduleForPath(path)
}
