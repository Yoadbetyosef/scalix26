'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useState } from 'react'
import { LayoutDashboard, Building2, ToggleRight, Flag, ScrollText, Users, Search, DollarSign, Activity, Coins, Handshake } from 'lucide-react'

const NAV = [
  { href: '/admin', label: 'Dashboard', icon: LayoutDashboard, exact: true },
  { href: '/admin/businesses', label: 'Businesses', icon: Building2 },
  { href: '/admin/partners', label: 'Partners', icon: Handshake },
  { href: '/admin/modules', label: 'Modules', icon: ToggleRight },
  { href: '/admin/feature-flags', label: 'Feature Flags', icon: Flag },
  { href: '/admin/billing', label: 'Billing', icon: DollarSign },
  { href: '/admin/cost', label: 'Cost & Margin', icon: Coins },
  { href: '/admin/health', label: 'Health', icon: Activity },
  { href: '/admin/team', label: 'Team', icon: Users },
  { href: '/admin/audit', label: 'Audit Log', icon: ScrollText },
]

const roleLabel: Record<string, string> = {
  super_admin: 'Super Admin', support: 'Support', sales: 'Sales', developer: 'Developer', read_only: 'Read Only',
}

export function AdminNav({ email, role }: { email: string; role: string }) {
  const pathname = usePathname()
  const router = useRouter()
  const [q, setQ] = useState('')
  const active = (href: string, exact?: boolean) => (exact ? pathname === href : pathname === href || pathname.startsWith(href + '/'))
  const search = () => { if (q.trim()) router.push(`/admin/businesses?search=${encodeURIComponent(q.trim())}`) }

  return (
    <nav className="sticky top-0 z-30 bg-gray-900 text-white">
      <div className="mx-auto flex max-w-[1400px] flex-wrap items-center gap-x-1 gap-y-1 px-3 py-2 sm:px-6">
        <span className="mr-3 font-bold">Scalix Admin</span>
        {NAV.map(({ href, label, icon: Icon, exact }) => (
          <Link
            key={href}
            href={href}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm transition-colors ${
              active(href, exact) ? 'bg-white/15 text-white' : 'text-gray-300 hover:bg-white/10 hover:text-white'
            }`}
          >
            <Icon className="h-4 w-4" />
            <span>{label}</span>
          </Link>
        ))}
        <div className="ml-auto flex items-center gap-2 pl-2 text-xs text-gray-400">
          <div className="relative hidden md:block">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && search()}
              placeholder="Search businesses…"
              className="h-8 w-48 rounded-lg bg-white/10 pl-8 pr-2 text-xs text-white placeholder-gray-400 outline-none focus:bg-white/15"
            />
          </div>
          <span className="hidden lg:inline">
            {email} · <span className="text-gray-200">{roleLabel[role] || role}</span>
          </span>
          <Link href="/dashboard" className="rounded-lg px-2 py-1.5 hover:bg-white/10 hover:text-white">← App</Link>
        </div>
      </div>
    </nav>
  )
}
