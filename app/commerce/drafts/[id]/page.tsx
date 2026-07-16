import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireCommerceAccess } from '@/lib/commerce/guard'
import { getDraft } from '@/lib/commerce/drafts'
import { listLocations } from '@/lib/commerce/inventory'
import { listProducts } from '@/lib/commerce/catalog'
import { listReservationsForDraft } from '@/lib/commerce/reservations'
import { DraftEditor } from '@/components/commerce/draft-editor'

export const dynamic = 'force-dynamic'

export default async function DraftPage({ params }: { params: Promise<{ id: string }> }) {
  const c = await requireCommerceAccess(); if (!c) notFound()
  const id = (await params).id
  const d = await getDraft(id)
  if (!d) notFound()
  const [locations, products, reservations] = await Promise.all([listLocations(), listProducts({ includeDrafts: false }), listReservationsForDraft(id)])
  return (
    <div className="mx-auto max-w-5xl px-6 pb-16">
      <div className="mb-4"><Link href="/commerce/drafts" className="text-sm text-gray-500 hover:underline">← Drafts</Link></div>
      <DraftEditor
        draftId={id}
        initial={d.draft as Record<string, unknown>}
        initialItems={d.items as Record<string, unknown>[]}
        locations={locations}
        products={products.map((p) => ({ id: p.id, name: p.name, sku: p.sku, price: p.defaultPrice }))}
        reservationsCount={reservations.length}
      />
    </div>
  )
}
