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
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { NotificationCenter } from '@/components/dashboard/notification-center'
import { TrialWidget } from '@/components/dashboard/trial-widget'
import { ScalixLogo } from '@/components/brand/scalix-logo'
import { type BrandConfig, DEFAULT_BRAND, detectBrand } from '@/lib/brands'
import { ALL_MODULES, enabledModulesOf, effectiveModules, moduleForNav, type ModuleKey, type ModuleState } from '@/lib/modules'

const navItems = [
  { href: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
  { href: '/dashboard?tab=leads', icon: TrendingUp, label: 'Leads' },
  { href: '/inbox', icon: Inbox, label: 'Inbox' },
  { href: '/contacts', icon: Users, label: 'Contacts' },
  { href: '/catalog', icon: Package, label: 'Catalog' },
  { href: '/ai-employees', icon: Bot, label: 'AI Employees' },
  { href: '/test-ai', icon: FlaskConical, label: 'Test AI' },
  { href: '/analytics', icon: BarChart3, label: 'Analytics' },
  { href: '/reports', icon: FileText, label: 'Reports' },
  { href: '/settings#billing', icon: CreditCard, label: 'Billing & Subscription' },
  { href: '/settings', icon: Settings, label: 'Settings' },
]

// First 4 (visible) items go in the mobile bottom bar, the rest in the "More" drawer.
// The split happens per-render after module filtering (see visibleNav below).

export function Sidebar() {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const router = useRouter()
  const supabase = createClient()
  const [businessName, setBusinessName] = useState<string>('')
  const [brand, setBrand] = useState<BrandConfig>(DEFAULT_BRAND)
  const [plan, setPlan] = useState<string | null>(null)
  const [trialEndsAt, setTrialEndsAt] = useState<string | null>(null)
  const [moreOpen, setMoreOpen] = useState(false)
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
    async function loadBusinessName() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const [{ data: tenant }, { data: flagRows }] = await Promise.all([
        supabase.from('tenants').select('business_name, plan, trial_ends_at, enabled_modules, tags').eq('user_id', user.id).single(),
        supabase.from('module_flags').select('module, state'),
      ])
      if (tenant?.business_name) setBusinessName(tenant.business_name)
      setPlan(tenant?.plan ?? null)
      setTrialEndsAt(tenant?.trial_ends_at ?? null)
      // Effective modules = the business's own set filtered by the global feature-flag state.
      const flags = Object.fromEntries((flagRows || []).map((f) => [f.module, f.state as ModuleState]))
      const isEnterprise = Array.isArray(tenant?.tags) && tenant.tags.includes('Enterprise')
      setEnabledModules(effectiveModules(enabledModulesOf(tenant), flags, isEnterprise))
    }
    loadBusinessName()
  }, [])

  // Resolve the host-based brand (myLocksmith / Scalix26 / default) once on mount.
  useEffect(() => { setBrand(detectBrand()) }, [])

  // Close drawer on route change
  useEffect(() => { setMoreOpen(false) }, [pathname])

  async function handleSignOut() {
    await supabase.auth.signOut()
    router.push('/auth/login')
  }

  // Hide nav items whose module is disabled for this business. Items with no module
  // (Dashboard, Analytics, Reports, Billing, Settings) always show. Filtering before the
  // primary/more split keeps up to 4 items in the mobile bottom bar.
  const visibleNav = navItems.filter((i) => {
    const m = moduleForNav(i.href)
    return !m || enabledModules.includes(m)
  })
  const bottomPrimaryVisible = visibleNav.slice(0, 4)
  const bottomMoreVisible = visibleNav.slice(4)
  const moreActive = bottomMoreVisible.some(item => pathname.startsWith(item.href))

  return (
    <>
      {/* Desktop Sidebar — calm, light, premium */}
      <aside className="hidden md:flex flex-col w-16 xl:w-56 bg-white border-r border-hairline min-h-screen fixed left-0 top-0 bottom-0 z-40">
        {/* Logo — the one place the brand color lives */}
        <div className="flex items-center gap-2.5 px-4 py-5 border-b border-hairline">
          <ScalixLogo size={26} className="flex-shrink-0" />
          <span className="hidden xl:block text-ink font-semibold text-[15px] tracking-tight leading-tight truncate">
            {businessName || brand.name}
          </span>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-2 py-4 space-y-1">
          {visibleNav.map(({ href, icon: Icon, label }) => {
            const active = itemActive(href, label)
            return (
              <Link
                key={href}
                href={href}
                className={cn(
                  'tap-target flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors',
                  active
                    ? 'bg-sunken text-ink font-medium'
                    : 'text-subtle hover:bg-sunken/70 hover:text-ink'
                )}
              >
                <Icon className="w-5 h-5 flex-shrink-0" strokeWidth={active ? 2.25 : 2} />
                <span className="hidden xl:block">{label}</span>
              </Link>
            )
          })}
        </nav>

        {/* Trial / plan status */}
        {plan && (
          <div className="px-2 pt-2">
            <TrialWidget plan={plan} trialEndsAt={trialEndsAt} />
          </div>
        )}

        {/* Partner program — the viral loop entry point */}
        <div className="px-2 pt-2">
          <Link
            href="/partner"
            className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-accent-strong hover:bg-accent/5 transition-colors"
          >
            <Handshake className="w-5 h-5 flex-shrink-0" />
            <span className="hidden xl:block">Partner Program</span>
          </Link>
        </div>

        {/* Sign out */}
        <div className="px-2 py-4 border-t border-hairline">
          <button
            onClick={handleSignOut}
            className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-subtle hover:bg-sunken hover:text-ink transition-colors w-full"
          >
            <LogOut className="w-5 h-5 flex-shrink-0" />
            <span className="hidden xl:block">Sign Out</span>
          </button>
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
              <Link
                href="/partner"
                className="flex items-center gap-3 px-3 py-3.5 rounded-xl text-base font-medium text-accent-strong hover:bg-accent/5 w-full transition-all duration-150 [-webkit-tap-highlight-color:transparent] active:scale-[0.98]"
              >
                <Handshake className="w-5 h-5 flex-shrink-0" />
                Partner Program
              </Link>
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
