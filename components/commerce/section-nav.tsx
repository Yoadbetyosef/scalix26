'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'

// Sub-navigation across the Core commerce surfaces. Orders intentionally absent — orders live in the
// existing (legacy) Orders section; Core sales documents are estimates/quotes/invoices.
const LINKS = [
  { href: '/commerce/catalog', label: 'Catalog' },
  { href: '/commerce/estimates', label: 'Estimates' },
  { href: '/commerce/quotes', label: 'Quotes' },
  { href: '/commerce/invoices', label: 'Invoices' },
  { href: '/commerce/customers', label: 'Customers' },
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
