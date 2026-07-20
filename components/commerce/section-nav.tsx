'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'

// Sub-navigation across the Core commerce surfaces. Estimates + Quotes are unified into ONE "Proposals"
// module (legacy estimate/quote records remain readable inside it; old routes redirect there). Orders is a
// link to the EXISTING legacy /orders route (not a Core document) — neither duplicated nor replaced here.
const LINKS = [
  { href: '/commerce/catalog', label: 'Catalog' },
  { href: '/commerce/proposals', label: 'Proposals' },
  { href: '/orders', label: 'Orders' },
  { href: '/commerce/invoices', label: 'Invoices' },
  { href: '/commerce/customers', label: 'Customers' },
  { href: '/commerce/companies', label: 'Companies' },
  { href: '/commerce/workflows', label: 'Workflows' },
  { href: '/commerce/settings', label: 'Settings' },
]

export function SectionNav() {
  const pathname = usePathname()
  return (
    <nav className="no-scrollbar mb-6 flex gap-1 overflow-x-auto border-b border-hairline">
      {LINKS.map((l) => {
        const active = pathname === l.href || pathname.startsWith(l.href + '/')
        return (
          <Link key={l.href} href={l.href} className={cn('shrink-0 border-b-2 px-3 py-2.5 text-sm font-medium transition-colors', active ? 'border-accent text-ink' : 'border-transparent text-subtle hover:text-ink')}>
            {l.label}
          </Link>
        )
      })}
    </nav>
  )
}
