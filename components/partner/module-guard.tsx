'use client'

import { useEffect } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { partnerModuleForPath, type PartnerModuleKey } from '@/lib/partner/modules'

// Wholesale (white_label / reseller) partners run a different product — only these routes are theirs.
const WHOLESALE_ALLOWED = ['/partner/clients', '/partner/commissions', '/partner/billing', '/partner/marketing', '/partner/analytics', '/partner/branding', '/partner/team', '/partner/settings']

// Redirects to the dashboard on direct-URL access to a route that isn't part of this partner's
// product: for wholesale partners, any affiliate route; otherwise, a disabled module.
export function PartnerModuleGuard({ enabledModules, billingMode }: { enabledModules: PartnerModuleKey[]; billingMode?: string }) {
  const pathname = usePathname()
  const router = useRouter()
  useEffect(() => {
    const wholesale = billingMode === 'white_label' || billingMode === 'reseller'
    if (wholesale) {
      const allowed = pathname === '/partner' || WHOLESALE_ALLOWED.some((p) => pathname === p || pathname.startsWith(p + '/'))
      if (!allowed) router.replace('/partner')
      return
    }
    const m = partnerModuleForPath(pathname)
    if (m && !enabledModules.includes(m)) router.replace('/partner')
  }, [pathname, enabledModules, billingMode, router])
  return null
}
