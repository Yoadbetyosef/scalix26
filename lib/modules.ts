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
  { key: 'pipeline', label: 'CRM Pipeline', description: 'Leads & deal stages' },
  { key: 'scheduling', label: 'Scheduling', description: 'Appointments & availability' },
  { key: 'estimates', label: 'Estimates', description: 'Quotes & estimate requests' },
  { key: 'invoices', label: 'Invoices', description: 'Invoicing & billing docs' },
  { key: 'payments', label: 'Payments', description: 'Payment collection (Stripe)' },
  { key: 'analytics', label: 'Analytics', description: 'Reports & analytics' },
  { key: 'business_brain', label: 'Business Brain', description: 'AI business understanding' },
  { key: 'knowledge_base', label: 'Knowledge Base', description: 'AI knowledge base' },
  { key: 'orders', label: 'Orders', description: 'Orders & external factory/customer approvals' },
  { key: 'commerce', label: 'Commerce', description: 'Projects, catalog, inventory, customer orders & purchasing' },
] as const

export type ModuleKey = (typeof MODULES)[number]['key']

// ── Feature-flag lifecycle (global, per module) ──────────────────────────────────────
// Set by admins in /admin/feature-flags. Governs a module platform-wide, on TOP of each
// business's own enable/disable toggle.
export type ModuleState = 'disabled' | 'enabled' | 'beta' | 'enterprise'
export const MODULE_STATES: { key: ModuleState; label: string; hint: string }[] = [
  { key: 'enabled', label: 'Enabled', hint: 'Available to every business that has it on' },
  { key: 'beta', label: 'Beta', hint: 'Available, flagged as beta' },
  { key: 'enterprise', label: 'Enterprise Only', hint: 'Only businesses tagged Enterprise' },
  { key: 'disabled', label: 'Disabled', hint: 'Hidden for everyone, platform-wide' },
]
export const DEFAULT_MODULE_STATE: ModuleState = 'enabled'

export const ALL_MODULES: ModuleKey[] = MODULES.map((m) => m.key)

// New businesses start with the core modules ON; everything else is opt-in per business,
// toggled by a platform admin. Keep this in sync with the DB column default (migration).
export const DEFAULT_ENABLED_MODULES: ModuleKey[] = ['ai_voice', 'inbox', 'contacts']
export const OPTIONAL_MODULES: ModuleKey[] = ALL_MODULES.filter((m) => !DEFAULT_ENABLED_MODULES.includes(m))

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
  { prefix: '/catalog', module: 'inventory' },
  { prefix: '/pipeline', module: 'pipeline' },
  { prefix: '/estimates', module: 'estimates' },
  { prefix: '/analytics', module: 'analytics' },
  { prefix: '/invoices', module: 'invoices' },
  { prefix: '/payments', module: 'payments' },
  { prefix: '/orders', module: 'orders' },
  { prefix: '/commerce', module: 'commerce' },
]

/**
 * The modules a business can actually see, applying the global feature-flag state on top of
 * its own per-business toggles:
 *   - disabled   → hidden for everyone
 *   - enterprise → only for Enterprise-tagged businesses
 *   - enabled/beta → available if the business has it on
 */
export function effectiveModules(
  enabled: ModuleKey[],
  flags: Partial<Record<ModuleKey, ModuleState>> | null | undefined,
  isEnterprise: boolean,
): ModuleKey[] {
  return enabled.filter((m) => {
    const s = flags?.[m] ?? DEFAULT_MODULE_STATE
    if (s === 'disabled') return false
    if (s === 'enterprise' && !isEnterprise) return false
    return true
  })
}

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
