'use client'

import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import {
  LayoutDashboard,
  Inbox,
  Users,
  Package,
  Bot,
  BarChart3,
  FileText,
  Settings,
  CreditCard,
  LogOut,
  FlaskConical,
  TrendingUp,
  MoreHorizontal,
  X,
  Handshake,
  Shield,
  ClipboardList,
  Ship,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { NotificationCenter } from '@/components/dashboard/notification-center'
import { TrialWidget } from '@/components/dashboard/trial-widget'
import { ScalixLogo } from '@/components/brand/scalix-logo'
import { type BrandConfig, DEFAULT_BRAND, detectBrand } from '@/lib/brands'
import { useBrand } from '@/components/brand/brand-provider'
import { ALL_MODULES, enabledModulesOf, effectiveModules, moduleForNav, type ModuleKey, type ModuleState } from '@/lib/modules'
import { GROUP_HUE } from '@/app/(v2)/v2/nav-icons'
import { Calendar, BookLock } from 'lucide-react'
import '@/app/(v2)/v2/v2-tokens.css'

const navItems = [
  { href: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
  { href: '/dashboard?tab=leads', icon: TrendingUp, label: 'Leads' },
  { href: '/inbox', icon: Inbox, label: 'Inbox' },
  { href: '/contacts', icon: Users, label: 'Contacts' },
  { href: '/orders', icon: ClipboardList, label: 'Orders' },
  { href: '/catalog', icon: Package, label: 'Catalog' },
  // Beside Catalog, because that is what it fills. The page has existed since landed cost shipped and
  // was reachable only by typing the URL — so the tenant it was built for could upload a supplier
  // invoice, and had no way to find the screen that does it. moduleForNav resolves /landed-cost to
  // `landed_cost`, so this line is invisible to every business without the module and needs no gate
  // of its own. Deliberately absent from OPERATOR_SAFE_LABELS below: a supplier invoice IS the
  // business's cost structure line by line, and lib/invoices/store.ts already refuses an operator.
  { href: '/landed-cost', icon: Ship, label: 'Supplier bills' },
  { href: '/ai-employees', icon: Bot, label: 'AI Employees' },
  { href: '/test-ai', icon: FlaskConical, label: 'Test AI' },
  { href: '/analytics', icon: BarChart3, label: 'Analytics' },
  { href: '/reports', icon: FileText, label: 'Reports' },
  { href: '/settings#billing', icon: CreditCard, label: 'Billing & Subscription' },
  { href: '/settings', icon: Settings, label: 'Settings' },
]

// ── THE THREE SECTIONS, /v2's ────────────────────────────────────────────────────────────────────
//
// Labels only. Every href, icon and module gate stays in navItems above, untouched — this says which
// section a label belongs to and nothing else, so a route cannot acquire a different destination by
// being regrouped.
//
// TWO LABELS HAVE NO v1 ROUTE and are rendered inert, exactly as /v2 renders them:
//   Appointments — /v2/appointments exists, v1 has none. Its nearest relative, /settings/availability,
//                  configures when you are free rather than showing what is booked. Not the same page.
//   Knowledge    — has no route of its own on either side; /v2's nav.ts says so in as many words. It
//                  is a section of an AI employee's detail screen, reached through that employee.
// A row that goes nowhere is honest. A row pointed at an approximate page is not.
const SECTIONS: { id: string; label: string; items: string[] }[] = [
  { id: 'g1', label: 'Rudi', items: ['Inbox', 'Appointments', 'Contacts', 'AI Employees', 'Knowledge', 'Test AI'] },
  { id: 'g2', label: 'Business', items: ['Leads', 'Orders', 'Catalog', 'Supplier bills', 'Analytics', 'Reports'] },
  { id: 'g3', label: 'Account', items: ['Billing & Subscription', 'Settings'] },
]
// Dashboard is in none of the three, because it is not a destination among destinations — it is the
// screen the rail sits beside. It stays above them, where /v2 puts its primaries.
const PRIMARY_LABEL = 'Dashboard'

/** Marks for the two rows that have no page. Same icons /v2 gives them. */
const INERT = new Map<string, typeof Calendar>([['Appointments', Calendar], ['Knowledge', BookLock]])

// First 4 (visible) items go in the mobile bottom bar, the rest in the "More" drawer.
// The split happens per-render after module filtering (see visibleNav below).

// Routes verified operator-safe (reads AND mutations scoped to the active client tenant). These appear
// in a White Label operator's client workspace — the FULL product minus Scalix billing. "Billing &
// Subscription" is intentionally excluded (a client's plan is governed by the partner, never Scalix).
const OPERATOR_SAFE_LABELS = new Set<string>(['Dashboard', 'Leads', 'Inbox', 'Contacts', 'Catalog', 'AI Employees', 'Test AI', 'Analytics', 'Reports', 'Settings'])

export function Sidebar({ operator = false, whiteLabel = false, operatorBusinessName = null, operatorModules }: {
  operator?: boolean
  // True across the whole White Label plane (partner operating a client OR a WL customer's own login):
  // hides Partner Program, Admin, and Scalix billing. `operator` additionally drives tenant resolution.
  whiteLabel?: boolean
  operatorBusinessName?: string | null
  operatorModules?: ModuleKey[]
} = {}) {
  const hidePartnerSurfaces = operator || whiteLabel
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const router = useRouter()
  const supabase = createClient()
  // RUDI open, the others closed — /v2 opens its first group and leaves the rest shut.
  const [open, setOpen] = useState<Record<string, boolean>>({ g1: true })
  // Whether an employee is actually on duty. /v2 shows an ON badge beside AI Employees and derives
  // it as `some(e => e.is_active !== false)`; same test here, so the two surfaces cannot disagree
  // about whether anybody is answering.
  const [aiOn, setAiOn] = useState(false)
  const [businessName, setBusinessName] = useState<string>('')
  const [brand, setBrand] = useState<BrandConfig>(DEFAULT_BRAND)
  const pb = useBrand() // DB-driven partner brand (resolved by domain)
  const [plan, setPlan] = useState<string | null>(null)
  const [trialEndsAt, setTrialEndsAt] = useState<string | null>(null)
  const [moreOpen, setMoreOpen] = useState(false)
  const [isAdmin, setIsAdmin] = useState(false)
  // Default to ALL so nothing flickers/hides before the tenant's modules load.
  const [enabledModules, setEnabledModules] = useState<ModuleKey[]>(ALL_MODULES)

  // Dashboard and Leads both live at /dashboard (Leads is ?tab=leads), so the
  // active highlight has to look at the tab, not just the pathname.
  const onLeadsTab = pathname === '/dashboard' && searchParams.get('tab') === 'leads'
  const itemActive = (href: string, label: string) => {
    if (label === 'Leads') return onLeadsTab
    if (label === 'Dashboard') return pathname === '/dashboard' && !onLeadsTab
    return pathname.startsWith(href)
  }

  useEffect(() => {
    // Operator mode: the client can't be resolved via user_id (that's the PARTNER's tenant). Use the
    // server-validated client name + client modules passed as props, and never load the partner's
    // plan/trial (no Scalix billing inside a client workspace).
    if (operator) {
      setBusinessName(operatorBusinessName || '')
      if (operatorModules) setEnabledModules(operatorModules)
      return
    }
    async function loadBusinessName() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const [{ data: tenant }, { data: flagRows }] = await Promise.all([
        supabase.from('tenants').select('id, business_name, plan, trial_ends_at, enabled_modules, tags').eq('user_id', user.id).single(),
        supabase.from('module_flags').select('module, state'),
      ])
      if (tenant?.business_name) setBusinessName(tenant.business_name)
      setPlan(tenant?.plan ?? null)
      setTrialEndsAt(tenant?.trial_ends_at ?? null)
      // Effective modules = the business's own set filtered by the global feature-flag state.
      const flags = Object.fromEntries((flagRows || []).map((f) => [f.module, f.state as ModuleState]))
      const isEnterprise = Array.isArray(tenant?.tags) && tenant.tags.includes('Enterprise')
      setEnabledModules(effectiveModules(enabledModulesOf(tenant), flags, isEnterprise))
      if (tenant?.id) {
        const { data: emps } = await supabase.from('ai_employees').select('is_active').eq('tenant_id', tenant.id)
        setAiOn(!!emps?.some((e) => (e as { is_active?: boolean }).is_active !== false))
      }
    }
    loadBusinessName()
  }, [operator, operatorBusinessName, operatorModules])

  // Resolve the host-based brand (myLocksmith / Scalix26 / default) once on mount.
  useEffect(() => { setBrand(detectBrand()) }, [])

  // Admin-only: show the Admin link if this user resolves to a platform admin (server-verified).
  // NEVER inside a client workspace — admin/partner surfaces must not leak into operator mode.
  useEffect(() => {
    if (hidePartnerSurfaces) { setIsAdmin(false); return }
    fetch('/api/me/admin').then((r) => r.json()).then((j) => setIsAdmin(!!j.isAdmin)).catch(() => {})
  }, [hidePartnerSurfaces])

  // Close drawer on route change
  useEffect(() => { setMoreOpen(false) }, [pathname])

  async function handleSignOut() {
    // Clear any active operator workspace cookie before signing out (best-effort; the httpOnly
    // cookie can only be cleared server-side, and middleware also clears it when there's no user).
    if (operator) await fetch('/api/partner/workspace', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'exit' }) }).catch(() => {})
    await supabase.auth.signOut()
    router.push('/auth/login')
  }

  // Hide nav items whose module is disabled for this business. Items with no module
  // (Dashboard, Analytics, Reports, Billing, Settings) always show. Filtering before the
  // primary/more split keeps up to 4 items in the mobile bottom bar.
  const visibleNav = navItems.filter((i) => {
    // The whole White Label plane (partner operating a client, OR a WL customer's own login) never sees
    // Scalix billing — a client's plan is governed by the partner. All product routes are operator-safe.
    if (hidePartnerSurfaces && i.label === 'Billing & Subscription') return false
    // Belt-and-suspenders: in impersonation mode keep the verified operator-safe allowlist.
    if (operator && !OPERATOR_SAFE_LABELS.has(i.label)) return false
    const m = moduleForNav(i.href)
    return !m || enabledModules.includes(m)
  })
  const bottomPrimaryVisible = visibleNav.slice(0, 4)
  const bottomMoreVisible = visibleNav.slice(4)
  const moreActive = bottomMoreVisible.some(item => pathname.startsWith(item.href))

  return (
    <>
      {/* THE RAIL, /v2's. Same markup, same classes, same collapsing sections — v1's routes.
          `.v2` carries the tokens every rule below reads; the rules themselves are scoped to it, so
          nothing here can reach the page beside it. */}
      <aside className="v2 hidden md:flex w-16 xl:w-[236px] h-screen fixed left-0 top-0 bottom-0 z-40">
        <div className="v2-rail" data-scroll style={{ width: '100%' }}>
          {/* YOUR BUSINESS, and the employee under it. The logo moved out: /v2 leads with whose
              business this is, not with whose software it is. Partner brands keep their mark beside it. */}
          <div className="v2-co">
            {pb?.isPartnerBrand && pb.logoUrl
              ? <img src={pb.logoUrl} alt={pb.name} className="mb-2 h-5 w-auto max-w-[120px] object-contain" />
              : null}
            <b className="hidden xl:block">{businessName || pb?.name || brand.name}</b>
            <span className="hidden xl:flex"><i />Rudi · on duty</span>
          </div>

          {/* The home row, above the sections. */}
          <div className="v2-stagger" style={{ ['--ghue' as string]: 'var(--v2-t1)' }}>
            {visibleNav.filter((i) => i.label === PRIMARY_LABEL).map(({ href, icon: Icon, label }) => (
              <Link key={href} href={href} className="v2-nav v2-grow" data-touch data-on={itemActive(href, label) || undefined}>
                <span className="v2-gchip"><Icon /></span>
                <span className="v2-glab hidden xl:block">{label}</span>
              </Link>
            ))}
          </div>

          {SECTIONS.map((g) => {
            const items = g.items
              .map((label) => visibleNav.find((i) => i.label === label) ?? (INERT.has(label) ? { href: '', icon: INERT.get(label)!, label } : null))
              .filter(Boolean) as { href: string; icon: typeof Handshake; label: string }[]
            if (!items.length) return null
            return (
              <div key={g.id} style={{ ['--ghue' as string]: GROUP_HUE[g.id] }}>
                <button
                  type="button"
                  className="v2-gh"
                  data-open={open[g.id] || undefined}
                  onClick={() => setOpen((p) => ({ ...p, [g.id]: !p[g.id] }))}
                  aria-expanded={!!open[g.id]}
                >
                  <i className="v2-gdot" />
                  <span className="hidden xl:block">{g.label}</span>
                  <s className="v2-grule" />
                  <svg viewBox="0 0 24 24" aria-hidden><path d="M9 6l6 6-6 6" /></svg>
                </button>
                <div className="v2-sub" data-open={open[g.id] || undefined}>
                  {items.map(({ href, icon: Icon, label }) => {
                    const inner = (
                      <>
                        <span className="v2-gchip"><Icon /></span>
                        <span className="v2-glab hidden xl:block">{label}</span>
                        {/* Only where /v2 puts it, and only when somebody is actually on duty — a badge
                            that is always lit says nothing. */}
                        {label === 'AI Employees' && aiOn && <em data-live>ON</em>}
                      </>
                    )
                    const attrs = { className: 'v2-nav v2-grow', 'data-touch': true, 'data-on': (href && itemActive(href, label)) || undefined }
                    // No href means no page — inert, the way /v2 renders the same two rows.
                    return href
                      ? <Link key={label} href={href} {...attrs}>{inner}</Link>
                      : <button key={label} type="button" {...attrs} disabled>{inner}</button>
                  })}
                </div>
              </div>
            )
          })}

          {/* The plan, as a ROW rather than a red block. Same TrialWidget data, same gating. */}
          {!hidePartnerSurfaces && plan && (
            <div style={{ ['--ghue' as string]: GROUP_HUE.g3 }}>
              <TrialWidget plan={plan} trialEndsAt={trialEndsAt} />
            </div>
          )}

          {!hidePartnerSurfaces && (
            <div style={{ ['--ghue' as string]: GROUP_HUE.g3 }}>
              <Link href="/partner" className="v2-nav v2-grow" data-touch>
                <span className="v2-gchip"><Handshake /></span>
                <span className="v2-glab hidden xl:block">Partner Program</span>
              </Link>
              {isAdmin && (
                <Link href="/admin" className="v2-nav v2-grow" data-touch>
                  <span className="v2-gchip"><Shield /></span>
                  <span className="v2-glab hidden xl:block">Admin</span>
                </Link>
              )}
            </div>
          )}

          <div className="mt-auto" style={{ ['--ghue' as string]: GROUP_HUE.g3 }}>
            <button type="button" onClick={handleSignOut} className="v2-nav v2-grow" data-touch>
              <span className="v2-gchip"><LogOut /></span>
              <span className="v2-glab hidden xl:block">Sign Out</span>
            </button>
            {pb?.isPartnerBrand && pb.poweredByScalix && <div className="hidden xl:block px-3 pt-2 text-[10px] text-muted">Powered by Scalix</div>}
          </div>
        </div>
      </aside>

      {/* Mobile Bottom Bar */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-white/95 backdrop-blur border-t border-hairline z-40 flex safe-area-inset-bottom">
        {bottomPrimaryVisible.map(({ href, icon: Icon, label }) => {
          const active = itemActive(href, label)
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                'tap-target flex-1 flex flex-col items-center py-2 pt-3 text-[10px] font-medium min-h-[56px] justify-center rounded-xl transition-all duration-150 [-webkit-tap-highlight-color:transparent] active:scale-[0.9] active:bg-accent/10 active:text-accent-strong',
                active ? 'text-ink' : 'text-muted'
              )}
            >
              <Icon className="w-5 h-5 mb-1" />
              <span>{label}</span>
            </Link>
          )
        })}
        {/* More button */}
        <button
          onClick={() => setMoreOpen(true)}
          className={cn(
            'flex-1 flex flex-col items-center py-2 pt-3 text-[10px] font-medium min-h-[56px] justify-center rounded-xl transition-all duration-150 [-webkit-tap-highlight-color:transparent] active:scale-[0.9] active:bg-accent/10 active:text-accent-strong',
            moreActive ? 'text-ink' : 'text-muted'
          )}
        >
          <MoreHorizontal className="w-5 h-5 mb-1" />
          <span>More</span>
        </button>
      </nav>

      {/* Mobile More Drawer */}
      {moreOpen && (
        <div className="md:hidden fixed inset-0 z-50">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setMoreOpen(false)}
          />
          {/* Drawer */}
          <div className="absolute bottom-0 left-0 right-0 bg-white rounded-t-2xl shadow-2xl">
            <div className="flex items-center justify-between px-5 py-4 border-b border-hairline">
              <span className="font-semibold text-ink">
                {businessName || brand.name}
              </span>
              <button
                onClick={() => setMoreOpen(false)}
                className="w-11 h-11 -m-1.5 flex items-center justify-center rounded-full bg-sunken text-subtle"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <nav className="px-4 py-3">
              {bottomMoreVisible.map(({ href, icon: Icon, label }) => {
                const active = itemActive(href, label)
                return (
                  <Link
                    key={href}
                    href={href}
                    className={cn(
                      'tap-target flex items-center gap-3 px-3 py-3.5 rounded-xl text-base transition-all duration-150 [-webkit-tap-highlight-color:transparent] active:scale-[0.98] active:bg-accent/10 active:text-accent-strong',
                      active
                        ? 'bg-sunken text-ink font-medium'
                        : 'text-subtle hover:bg-sunken'
                    )}
                  >
                    <Icon className="w-5 h-5 flex-shrink-0" />
                    {label}
                  </Link>
                )
              })}
            </nav>
            <div className="px-4 pb-6 border-t border-hairline pt-3 space-y-1">
              {!hidePartnerSurfaces && (
                <Link
                  href="/partner"
                  className="flex items-center gap-3 px-3 py-3.5 rounded-xl text-base font-medium text-accent-strong hover:bg-accent/5 w-full transition-all duration-150 [-webkit-tap-highlight-color:transparent] active:scale-[0.98]"
                >
                  <Handshake className="w-5 h-5 flex-shrink-0" />
                  Partner Program
                </Link>
              )}
              {!hidePartnerSurfaces && isAdmin && (
                <Link
                  href="/admin"
                  className="flex items-center gap-3 px-3 py-3.5 rounded-xl text-base font-medium text-subtle hover:bg-sunken w-full transition-all duration-150 [-webkit-tap-highlight-color:transparent] active:scale-[0.98]"
                >
                  <Shield className="w-5 h-5 flex-shrink-0" />
                  Admin
                </Link>
              )}
              <button
                onClick={handleSignOut}
                className="flex items-center gap-3 px-3 py-3.5 rounded-xl text-base font-medium text-red-500 hover:bg-red-50 w-full transition-all duration-150 [-webkit-tap-highlight-color:transparent] active:scale-[0.98] active:bg-red-100"
              >
                <LogOut className="w-5 h-5 flex-shrink-0" />
                Sign Out
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Persistent notification center — bell, bottom-right */}
      <NotificationCenter />
    </>
  )
}
