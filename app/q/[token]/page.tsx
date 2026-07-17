import { notFound } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/server'
import { AVAILABILITY_LABELS, type AvailabilityStatus } from '@/lib/catalog/types'

export const dynamic = 'force-dynamic'

// PUBLIC part page — the target of a part's QR code. No auth: looked up by the unguessable qr_code_token
// via the service-role client. Shows only customer-safe fields (photo, name, price, availability).
const badge: Record<AvailabilityStatus, string> = {
  in_stock: 'bg-emerald-100 text-emerald-800', out_of_stock: 'bg-red-100 text-red-800',
  incoming: 'bg-amber-100 text-amber-800', special_order: 'bg-violet-100 text-violet-800',
}

export default async function PublicPartPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const db = createAdminClient()
  const { data: part } = await db.from('catalog_product_parts')
    .select('name, image_url, price, availability_status, product_id, tenant_id')
    .eq('qr_code_token', token).maybeSingle()
  if (!part) notFound()
  const { data: product } = await db.from('catalog_products').select('name, brand').eq('id', part.product_id).maybeSingle()
  const av = part.availability_status as AvailabilityStatus

  return (
    <main className="min-h-screen bg-gray-50 px-4 py-10 text-gray-900">
      <div className="mx-auto max-w-md overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
        {part.image_url
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={part.image_url} alt={part.name} className="h-64 w-full object-cover" />
          : <div className="flex h-40 w-full items-center justify-center bg-gray-100 text-gray-400">No photo</div>}
        <div className="p-5">
          {product?.name && <p className="text-xs uppercase tracking-wide text-gray-400">{product.name}{product.brand ? ` · ${product.brand}` : ''}</p>}
          <h1 className="mt-1 text-2xl font-bold">{part.name}</h1>
          <div className="mt-3 flex items-center gap-3">
            <span className={`rounded-full px-2.5 py-1 text-sm font-medium ${badge[av]}`}>{AVAILABILITY_LABELS[av]}</span>
            {part.price !== null && <span className="text-xl font-semibold">${Number(part.price).toLocaleString()}</span>}
          </div>
        </div>
      </div>
    </main>
  )
}
