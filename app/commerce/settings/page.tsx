import { notFound } from 'next/navigation'
import { requireCommerceAccess } from '@/lib/commerce/guard'
import { qboConfigured } from '@/lib/commerce/quickbooks/config'
import { getStatus } from '@/lib/commerce/quickbooks/connection'
import { QuickBooksCard } from '@/components/commerce/quickbooks-card'

export const dynamic = 'force-dynamic'

const BANNERS: Record<string, { text: string; tone: 'ok' | 'err' }> = {
  connected: { text: 'QuickBooks connected.', tone: 'ok' },
  denied: { text: 'QuickBooks connection was cancelled.', tone: 'err' },
  error: { text: 'Could not connect to QuickBooks. Please try again.', tone: 'err' },
  not_configured: { text: 'QuickBooks is not configured on this environment yet.', tone: 'err' },
}

export default async function CommerceSettingsPage({ searchParams }: { searchParams: Promise<{ qb?: string }> }) {
  const c = await requireCommerceAccess(); if (!c) notFound()
  const [status, { qb }] = await Promise.all([getStatus(c.tenantId), searchParams])
  const banner = qb ? BANNERS[qb] : null

  return (
    <div className="mx-auto max-w-3xl px-6 pb-16">
      <h1 className="mb-1 text-2xl font-semibold text-gray-900">Commerce Settings</h1>
      <p className="mb-5 text-sm text-gray-500">Integrations and preferences for your commerce workspace.</p>
      {banner && (
        <div className={`mb-4 rounded-lg border px-3 py-2 text-sm ${banner.tone === 'ok' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-red-200 bg-red-50 text-red-700'}`}>{banner.text}</div>
      )}
      <QuickBooksCard configured={qboConfigured()} status={status} />
    </div>
  )
}
