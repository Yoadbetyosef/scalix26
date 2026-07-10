'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useState } from 'react'
import {
  LayoutDashboard, Share2, Building2, KanbanSquare, MonitorPlay, Coins,
  Megaphone, GraduationCap, Store, Users, BarChart3, Settings, LogOut,
  MoreHorizontal, X, ArrowLeftRight, Trophy, Brain, CreditCard, Palette, Wallet, Plug,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { createClient } from '@/lib/supabase/client'
import { ScalixLogo } from '@/components/brand/scalix-logo'
import { type PartnerType } from '@/lib/partner/roles'
import { partnerModuleForPath, type PartnerModuleKey } from '@/lib/partner/modules'

export interface PartnerNavProps {
  companyName: string | null
  slug: string
  partnerType: PartnerType
  billingMode?: string
  hasTenant: boolean
  enabledModules: PartnerModuleKey[]
}

// White-label / reseller partners run a different product — a dedicated nav, no affiliate concepts.
const WHOLESALE_ITEMS = [
  { href: '/partner', icon: LayoutDashboard, label: 'Dashboard', exact: true },
  { href: '/partner/clients', icon: Building2, label: 'Client Accounts' },
  { href: '/partner/infrastructure', icon: Plug, label: 'Infrastructure' },
  { href: '/partner/commissions', icon: Wallet, label: 'Partner Economics' },
  { href: '/partner/billing', icon: CreditCard, label: 'Billing' },
  { href: '/partner/marketing', icon: Megaphone, label: 'Marketing' },
  { href: '/partner/analytics', icon: BarChart3, label: 'Analytics' },
  { href: '/partner/branding', icon: Palette, label: 'Branding' },
  { href: '/partner/team', icon: Users, label: 'Team' },
  { href: '/partner/settings', icon: Settings, label: 'Settings' },
]

const TYPE_LABEL: Partial<Record<PartnerType, string>> = {
  affiliate: 'Affiliate', creator: 'Creator', growth: 'Growth Partner', agency: 'Agency',
  technology: 'Technology', implementation: 'Implementation', industry_expert: 'Industry Expert',
  franchise: 'Franchise', white_label: 'White Label', enterprise: 'Enterprise', internal_rep: 'Internal Rep',
}

export function PartnerSidebar({ companyName, partnerType, billingMode, hasTenant, enabledModules }: PartnerNavProps) {
  const pathname = usePathname()
  const router = useRouter()
  const supabase = createClient()
  const [moreOpen, setMoreOpen] = useState(false)
  const wholesale = billingMode === 'white_label' || billingMode === 'reseller'
  const roleLabel = wholesale ? (billingMode === 'white_label' ? 'White Label' : 'Reseller') : (TYPE_LABEL[partnerType] || 'Partner')

  const allItems = [
    { href: '/partner', icon: LayoutDashboard, label: 'Dashboard', exact: true },
    { href: '/partner/coach', icon: Brain, label: 'AI Coach' },
    { href: '/partner/referrals', icon: Share2, label: 'Referrals' },
    { href: '/partner/customers', icon: Building2, label: 'Customers' },
    { href: '/partner/pipeline', icon: KanbanSquare, label: 'Pipeline' },
    { href: '/partner/demos', icon: MonitorPlay, label: 'Demos' },
    { href: '/partner/commissions', icon: Coins, label: 'Commissions' },
    { href: '/partner/marketing', icon: Megaphone, label: 'Marketing' },
    { href: '/partner/learning', icon: GraduationCap, label: 'Academy' },
    { href: '/partner/leaderboard', icon: Trophy, label: 'Leaderboard' },
    { href: '/partner/marketplace', icon: Store, label: 'Marketplace' },
    { href: '/partner/team', icon: Users, label: 'Team' },
    { href: '/partner/analytics', icon: BarChart3, label: 'Analytics' },
    { href: '/partner/settings', icon: Settings, label: 'Settings' },
  ]
  // White-label / reseller → dedicated wholesale nav. Otherwise the affiliate nav, gated by the
  // partner's enabled module set (core routes have no module → always shown).
  const items = wholesale ? WHOLESALE_ITEMS : allItems.filter((i) => {
    const m = partnerModuleForPath(i.href)
    return !m || enabledModules.includes(m)
  })

  const isActive = (href: string, exact?: boolean) => (exact ? pathname === href : pathname === href || pathname.startsWith(href + '/'))

  async function handleSignOut() {
    await supabase.auth.signOut()
    router.push('/partner/login')
  }

  const primary = items.slice(0, 4)
  const overflow = items.slice(4)

  return (
    <>
      <aside className="hidden md:flex flex-col w-16 xl:w-56 bg-white border-r border-hairline min-h-screen fixed left-0 top-0 bottom-0 z-40">
        <div className="flex items-center gap-2.5 px-4 py-5 border-b border-hairline">
          <ScalixLogo size={26} className="flex-shrink-0" />
          <div className="hidden xl:block min-w-0">
            <div className="text-ink font-semibold text-[15px] tracking-tight leading-tight truncate">{companyName || 'Partner'}</div>
            <div className="text-[11px] text-muted leading-tight">{roleLabel} · Partner</div>
          </div>
        </div>

        <nav className="flex-1 px-2 py-4 space-y-1 overflow-y-auto">
          {items.map(({ href, icon: Icon, label, exact }) => {
            const active = isActive(href, exact)
            return (
              <Link key={href} href={href}
                className={cn('tap-target flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors',
                  active ? 'bg-sunken text-ink font-medium' : 'text-subtle hover:bg-sunken/70 hover:text-ink')}>
                <Icon className="w-5 h-5 flex-shrink-0" strokeWidth={active ? 2.25 : 2} />
                <span className="hidden xl:block">{label}</span>
              </Link>
            )
          })}
        </nav>

        {hasTenant && (
          <div className="px-2 pt-2">
            <Link href="/dashboard"
              className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-subtle hover:bg-sunken hover:text-ink transition-colors">
              <ArrowLeftRight className="w-5 h-5 flex-shrink-0" />
              <span className="hidden xl:block">Switch to Business</span>
            </Link>
          </div>
        )}

        <div className="px-2 py-4 border-t border-hairline">
          <button onClick={handleSignOut}
            className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-subtle hover:bg-sunken hover:text-ink transition-colors w-full">
            <LogOut className="w-5 h-5 flex-shrink-0" />
            <span className="hidden xl:block">Sign Out</span>
          </button>
        </div>
      </aside>

      {/* Mobile bottom bar */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-white/95 backdrop-blur border-t border-hairline z-40 flex safe-area-inset-bottom">
        {primary.map(({ href, icon: Icon, label, exact }) => {
          const active = isActive(href, exact)
          return (
            <Link key={href} href={href}
              className={cn('tap-target flex-1 flex flex-col items-center py-2 pt-3 text-[10px] font-medium min-h-[56px] justify-center rounded-xl transition-all active:scale-[0.9]',
                active ? 'text-ink' : 'text-muted')}>
              <Icon className="w-5 h-5 mb-1" /><span>{label}</span>
            </Link>
          )
        })}
        <button onClick={() => setMoreOpen(true)}
          className="flex-1 flex flex-col items-center py-2 pt-3 text-[10px] font-medium min-h-[56px] justify-center rounded-xl text-muted active:scale-[0.9]">
          <MoreHorizontal className="w-5 h-5 mb-1" /><span>More</span>
        </button>
      </nav>

      {moreOpen && (
        <div className="md:hidden fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/40" onClick={() => setMoreOpen(false)} />
          <div className="absolute bottom-0 left-0 right-0 bg-white rounded-t-2xl shadow-2xl">
            <div className="flex items-center justify-between px-5 py-4 border-b border-hairline">
              <span className="font-semibold text-ink">{companyName || 'Partner'}</span>
              <button onClick={() => setMoreOpen(false)} className="w-11 h-11 -m-1.5 flex items-center justify-center rounded-full bg-sunken text-subtle"><X className="w-4 h-4" /></button>
            </div>
            <nav className="px-4 py-3 max-h-[60vh] overflow-y-auto">
              {overflow.map(({ href, icon: Icon, label, exact }) => {
                const active = isActive(href, exact)
                return (
                  <Link key={href} href={href} onClick={() => setMoreOpen(false)}
                    className={cn('tap-target flex items-center gap-3 px-3 py-3.5 rounded-xl text-base transition-all active:scale-[0.98]',
                      active ? 'bg-sunken text-ink font-medium' : 'text-subtle hover:bg-sunken')}>
                    <Icon className="w-5 h-5 flex-shrink-0" />{label}
                  </Link>
                )
              })}
              {hasTenant && (
                <Link href="/dashboard" onClick={() => setMoreOpen(false)} className="flex items-center gap-3 px-3 py-3.5 rounded-xl text-base text-subtle hover:bg-sunken">
                  <ArrowLeftRight className="w-5 h-5 flex-shrink-0" />Switch to Business
                </Link>
              )}
            </nav>
            <div className="px-4 pb-6 border-t border-hairline pt-3">
              <button onClick={handleSignOut} className="flex items-center gap-3 px-3 py-3.5 rounded-xl text-base font-medium text-red-500 hover:bg-red-50 w-full">
                <LogOut className="w-5 h-5 flex-shrink-0" />Sign Out
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
