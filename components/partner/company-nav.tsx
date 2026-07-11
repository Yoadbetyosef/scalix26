'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useState } from 'react'
import { Home, Building2, DollarSign, Megaphone, Palette, Users, Settings, LogOut, MoreHorizontal, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { createClient } from '@/lib/supabase/client'

// The company operating system's navigation. Framed entirely as the OWNER's own AI software company —
// no Scalix, no "partner", no "reseller". Header = the owner's brand; footer = the owner.
const NAV = [
  { href: '/partner', icon: Home, label: 'Home', exact: true },
  { href: '/partner/businesses', icon: Building2, label: 'Businesses' },
  { href: '/partner/revenue', icon: DollarSign, label: 'Revenue' },
  { href: '/partner/marketing', icon: Megaphone, label: 'Marketing' },
  { href: '/partner/branding', icon: Palette, label: 'Brand' },
  { href: '/partner/team', icon: Users, label: 'Team' },
  { href: '/partner/settings', icon: Settings, label: 'Settings' },
]

function BrandMark({ logoUrl, name }: { logoUrl: string | null; name: string }) {
  if (logoUrl) return <img src={logoUrl} alt={name} className="h-7 w-auto max-w-[132px] object-contain" />
  // No logo yet → a clean monogram tile in the company accent (never a Scalix mark).
  const initial = (name || 'A').trim().charAt(0).toUpperCase()
  return (
    <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-accent text-[15px] font-semibold text-white shadow-e1">{initial}</span>
  )
}

export function CompanyNav({ companyName, logoUrl, ownerName }: { companyName: string; logoUrl: string | null; ownerName: string | null }) {
  const pathname = usePathname()
  const router = useRouter()
  const supabase = createClient()
  const [moreOpen, setMoreOpen] = useState(false)

  const isActive = (href: string, exact?: boolean) => (exact ? pathname === href : pathname === href || pathname.startsWith(href + '/'))
  async function signOut() {
    await supabase.auth.signOut()
    router.push('/partner/login')
  }

  const primary = NAV.slice(0, 4)
  const overflow = NAV.slice(4)

  return (
    <>
      {/* Desktop rail */}
      <aside className="hidden md:flex flex-col w-16 xl:w-60 bg-white border-r border-hairline min-h-screen fixed left-0 top-0 bottom-0 z-40">
        <div className="flex items-center gap-2.5 px-4 py-5 border-b border-hairline">
          <BrandMark logoUrl={logoUrl} name={companyName} />
          <span className="hidden xl:block text-ink font-semibold text-[15px] tracking-tight leading-tight truncate">{companyName}</span>
        </div>

        <nav className="flex-1 px-2 py-4 space-y-0.5 overflow-y-auto">
          {NAV.map(({ href, icon: Icon, label, exact }) => {
            const active = isActive(href, exact)
            return (
              <Link key={href} href={href}
                className={cn('tap-target group flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-all duration-150',
                  active ? 'bg-accent/10 text-accent-strong font-semibold' : 'text-subtle hover:bg-sunken/70 hover:text-ink')}>
                <Icon className="w-5 h-5 flex-shrink-0 transition-transform duration-150 group-active:scale-90" strokeWidth={active ? 2.25 : 2} />
                <span className="hidden xl:block">{label}</span>
              </Link>
            )
          })}
        </nav>

        {/* Owner footer */}
        <div className="border-t border-hairline px-2 py-3">
          <div className="hidden xl:flex items-center gap-2.5 px-3 py-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-sunken text-xs font-semibold text-subtle">
              {(ownerName || 'Y').trim().charAt(0).toUpperCase()}
            </span>
            <div className="min-w-0">
              <div className="truncate text-sm font-medium text-ink">{ownerName || 'Owner'}</div>
              <div className="text-[11px] text-muted leading-tight">Owner</div>
            </div>
          </div>
          <button onClick={signOut}
            className="mt-0.5 flex w-full items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-subtle transition-colors hover:bg-sunken hover:text-ink">
            <LogOut className="w-5 h-5 flex-shrink-0" />
            <span className="hidden xl:block">Sign out</span>
          </button>
        </div>
      </aside>

      {/* Mobile bottom bar */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-white/95 backdrop-blur border-t border-hairline z-40 flex safe-area-inset-bottom">
        {primary.map(({ href, icon: Icon, label, exact }) => {
          const active = isActive(href, exact)
          return (
            <Link key={href} href={href}
              className={cn('tap-target flex-1 flex flex-col items-center py-2 pt-3 text-[10px] font-medium min-h-[56px] justify-center transition-all duration-150 active:scale-90',
                active ? 'text-accent-strong' : 'text-muted')}>
              <Icon className="w-5 h-5 mb-1" />
              <span>{label}</span>
            </Link>
          )
        })}
        <button onClick={() => setMoreOpen(true)}
          className="flex-1 flex flex-col items-center py-2 pt-3 text-[10px] font-medium min-h-[56px] justify-center text-muted transition-all active:scale-90">
          <MoreHorizontal className="w-5 h-5 mb-1" />
          <span>More</span>
        </button>
      </nav>

      {moreOpen && (
        <div className="md:hidden fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/40" onClick={() => setMoreOpen(false)} />
          <div className="absolute bottom-0 left-0 right-0 bg-white rounded-t-2xl shadow-2xl">
            <div className="flex items-center justify-between px-5 py-4 border-b border-hairline">
              <span className="font-semibold text-ink">{companyName}</span>
              <button onClick={() => setMoreOpen(false)} className="w-11 h-11 -m-1.5 flex items-center justify-center rounded-full bg-sunken text-subtle"><X className="w-4 h-4" /></button>
            </div>
            <nav className="px-4 py-3">
              {overflow.map(({ href, icon: Icon, label }) => (
                <Link key={href} href={href} onClick={() => setMoreOpen(false)}
                  className="flex items-center gap-3 px-3 py-3.5 rounded-xl text-base text-subtle hover:bg-sunken transition-all active:scale-[0.98]">
                  <Icon className="w-5 h-5 flex-shrink-0" />{label}
                </Link>
              ))}
              <button onClick={signOut}
                className="mt-1 flex items-center gap-3 px-3 py-3.5 rounded-xl text-base font-medium text-red-500 hover:bg-red-50 w-full transition-all active:scale-[0.98]">
                <LogOut className="w-5 h-5 flex-shrink-0" />Sign out
              </button>
            </nav>
          </div>
        </div>
      )}
    </>
  )
}
