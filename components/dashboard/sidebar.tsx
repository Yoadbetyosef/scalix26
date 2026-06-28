'use client'

import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import {
  LayoutDashboard,
  Inbox,
  Users,
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
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { NotificationCenter } from '@/components/dashboard/notification-center'
import { TrialWidget } from '@/components/dashboard/trial-widget'
import { ScalixLogo } from '@/components/brand/scalix-logo'
import { type BrandConfig, DEFAULT_BRAND, detectBrand } from '@/lib/brands'

// Each destination wears its own color tile (macOS System Settings style) — the icons
// give the workspace life while the surface stays calm white.
const navItems = [
  { href: '/dashboard', icon: LayoutDashboard, label: 'Dashboard', tone: 'bg-blue-500' },
  { href: '/dashboard?tab=leads', icon: TrendingUp, label: 'Leads', tone: 'bg-emerald-500' },
  { href: '/inbox', icon: Inbox, label: 'Inbox', tone: 'bg-indigo-500' },
  { href: '/contacts', icon: Users, label: 'Contacts', tone: 'bg-cyan-500' },
  { href: '/ai-employees', icon: Bot, label: 'AI Employees', tone: 'bg-violet-500' },
  { href: '/test-ai', icon: FlaskConical, label: 'Test AI', tone: 'bg-fuchsia-500' },
  { href: '/analytics', icon: BarChart3, label: 'Analytics', tone: 'bg-orange-500' },
  { href: '/reports', icon: FileText, label: 'Reports', tone: 'bg-amber-500' },
  { href: '/settings#billing', icon: CreditCard, label: 'Billing & Subscription', tone: 'bg-emerald-600' },
  { href: '/settings', icon: Settings, label: 'Settings', tone: 'bg-slate-500' },
]

// Small colored icon tile shared by the desktop sidebar + mobile "More" drawer.
function NavTile({ icon: Icon, tone }: { icon: typeof LayoutDashboard; tone: string }) {
  return (
    <span className={cn('inline-flex h-7 w-7 items-center justify-center rounded-lg text-white shadow-e1 flex-shrink-0', tone)}>
      <Icon className="h-4 w-4" strokeWidth={2} />
    </span>
  )
}

// First 4 items in bottom bar, rest in "More" drawer
const bottomPrimary = navItems.slice(0, 4)
const bottomMore = navItems.slice(4)

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
      const { data: tenant } = await supabase
        .from('tenants')
        .select('business_name, plan, trial_ends_at')
        .eq('user_id', user.id)
        .single()
      if (tenant?.business_name) setBusinessName(tenant.business_name)
      setPlan(tenant?.plan ?? null)
      setTrialEndsAt(tenant?.trial_ends_at ?? null)
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

  const moreActive = bottomMore.some(item => pathname.startsWith(item.href))

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
          {navItems.map(({ href, icon: Icon, label, tone }) => {
            const active = itemActive(href, label)
            return (
              <Link
                key={href}
                href={href}
                className={cn(
                  'tap-target flex items-center gap-2.5 px-2 py-2 rounded-xl text-sm transition-colors',
                  active
                    ? 'bg-sunken text-ink font-medium'
                    : 'text-subtle hover:bg-sunken/70 hover:text-ink'
                )}
              >
                <NavTile icon={Icon} tone={tone} />
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
        {bottomPrimary.map(({ href, icon: Icon, label }) => {
          const active = itemActive(href, label)
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                'tap-target flex-1 flex flex-col items-center py-2 pt-3 text-[10px] font-medium transition-colors min-h-[56px] justify-center',
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
            'flex-1 flex flex-col items-center py-2 pt-3 text-[10px] font-medium transition-colors min-h-[56px] justify-center',
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
              {bottomMore.map(({ href, icon: Icon, label, tone }) => {
                const active = itemActive(href, label)
                return (
                  <Link
                    key={href}
                    href={href}
                    className={cn(
                      'tap-target flex items-center gap-3 px-2.5 py-2.5 rounded-xl text-base transition-colors',
                      active
                        ? 'bg-sunken text-ink font-medium'
                        : 'text-subtle hover:bg-sunken'
                    )}
                  >
                    <NavTile icon={Icon} tone={tone} />
                    {label}
                  </Link>
                )
              })}
            </nav>
            <div className="px-4 pb-6 border-t border-hairline pt-3">
              <button
                onClick={handleSignOut}
                className="flex items-center gap-3 px-3 py-3.5 rounded-xl text-base font-medium text-red-500 hover:bg-red-50 transition-colors w-full"
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
