'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import { useTerminology } from '@/lib/hooks/use-terminology'

// Sub-navigation across the Core commerce surfaces. Labels resolve through the tenant's terminology, so a
// furniture tenant can show "Inventory" (catalog) and "Fabrics" (material) without renaming any internal
// concept. Estimates + Quotes are unified into "Proposals"; Orders links to the legacy /orders route.

export function SectionNav() {
  const pathname = usePathname()
  const { term } = useTerminology()
  const links = [
    { href: '/commerce/catalog', label: term('catalog', { fallback: 'Catalog' }) },
    { href: '/commerce/fabrics', label: term('material', { plural: true, fallback: 'Materials' }) },
    { href: '/commerce/proposals', label: 'Proposals' },
    { href: '/orders', label: 'Orders' },
    { href: '/commerce/invoices', label: 'Invoices' },
    { href: '/commerce/customers', label: 'Customers' },
    { href: '/commerce/companies', label: 'Companies' },
    { href: '/commerce/workflows', label: 'Workflows' },
    { href: '/commerce/settings', label: 'Settings' },
  ]
  return (
    <nav className="no-scrollbar mb-6 flex gap-1 overflow-x-auto border-b border-hairline">
      {links.map((l) => {
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
