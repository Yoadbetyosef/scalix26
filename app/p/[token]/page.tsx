import { notFound } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/server'
import { getComponentByToken } from '@/lib/core/components'

export const dynamic = 'force-dynamic'

// PUBLIC component page — target of a component's QR. No auth: looked up by the unguessable token via the
// service-role client. Customer-safe fields only (photo, product, name, price, availability).
const AV: Record<string, { label: string; cls: string }> = {
  active: { label: 'Available', cls: 'bg-emerald-100 text-emerald-800' },
  inactive: { label: 'Unavailable', cls: 'bg-red-100 text-red-800' },
  discontinued: { label: 'Discontinued', cls: 'bg-gray-100 text-gray-700' },
}

export default async function PublicComponentPage({ params }: { params: Promise<{ token: string }> }) {
  const comp = await getComponentByToken((await params).token)
  if (!comp) notFound()
  const { data: product } = await createAdminClient().from('catalog_products').select('name, brand').eq('id', comp.product_id).maybeSingle()
  const av = AV[comp.status as string] ?? AV.active
  const price = comp.price_cents != null ? (Number(comp.price_cents) / 100).toLocaleString(undefined, { style: 'currency', currency: (comp.currency as string) || 'usd' }) : null

  return (
    <main className="min-h-screen bg-gray-50 px-4 py-10 text-gray-900">
      <div className="mx-auto max-w-md overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
        {comp.image_url
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={comp.image_url as string} alt={comp.name as string} className="h-64 w-full object-cover" />
          : <div className="flex h-40 w-full items-center justify-center bg-gray-100 text-gray-400">No photo</div>}
        <div className="p-5">
          {product?.name && <p className="text-xs uppercase tracking-wide text-gray-400">{product.name}{product.brand ? ` · ${product.brand}` : ''}</p>}
          <h1 className="mt-1 text-2xl font-bold">{comp.name as string}</h1>
          <div className="mt-3 flex items-center gap-3">
            <span className={`rounded-full px-2.5 py-1 text-sm font-medium ${av.cls}`}>{av.label}</span>
            {price && <span className="text-xl font-semibold">{price}</span>}
          </div>
        </div>
      </div>
    </main>
  )
}
