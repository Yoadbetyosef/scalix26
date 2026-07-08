'use client'

import { useEffect } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { partnerModuleForPath, type PartnerModuleKey } from '@/lib/partner/modules'

// Redirects to the dashboard if the current path belongs to a module the partner doesn't have.
// Nav is already filtered, but this covers direct URLs / bookmarks to disabled modules.
export function PartnerModuleGuard({ enabledModules }: { enabledModules: PartnerModuleKey[] }) {
  const pathname = usePathname()
  const router = useRouter()
  useEffect(() => {
    const m = partnerModuleForPath(pathname)
    if (m && !enabledModules.includes(m)) router.replace('/partner')
  }, [pathname, enabledModules, router])
  return null
}
