'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'

// Live sections in the current phase. Purchase Orders / Suppliers / Receiving / Settings arrive in
// later phases and are intentionally not linked yet.
const SECTIONS = [
  { href: '/commerce/projects', label: 'Projects' },
  { href: '/commerce/drafts', label: 'Drafts' },
  { href: '/commerce/catalog', label: 'Catalog' },
  { href: '/commerce/inventory', label: 'Inventory' },
]

export function CommerceNav() {
  const pathname = usePathname()
  return (
    <nav className="mb-5 flex flex-wrap gap-1 border-b border-gray-200">
      {SECTIONS.map((s) => {
        const active = pathname.startsWith(s.href)
        return (
          <Link key={s.href} href={s.href} className={cn('-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors', active ? 'border-gray-900 text-gray-900' : 'border-transparent text-gray-500 hover:text-gray-800')}>
            {s.label}
          </Link>
        )
      })}
    </nav>
  )
}
