import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ChevronLeft } from 'lucide-react'
import { requireOrdersAccess } from '@/lib/orders/guard'
import { OrderOptionsManager } from '@/components/settings/order-options-manager'

// Tenant-managed dropdown lists for the Orders module. Gated exactly like the rest of Orders — a tenant
// without the module gets a 404 rather than an empty page that hints the feature exists.
export const dynamic = 'force-dynamic'

export default async function OrderOptionsPage() {
  const a = await requireOrdersAccess()
  if (!a) notFound()

  return (
    <div className="v2 v2-embedded mx-auto max-w-5xl p-4 sm:p-6 max-md:pb-16">
      <div className="v2-head">
        <Link href="/settings" className="v2-act tap-target"><ChevronLeft className="w-3.5 h-3.5" /> Settings</Link>
        <p className="v2-kick" style={{ ['--ghue' as string]: 'var(--v2-t3)' }}><i />Order dropdowns</p>
        <s />
      </div>
      <OrderOptionsManager />
    </div>
  )
}
