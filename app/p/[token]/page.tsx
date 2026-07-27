import { notFound } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/server'
import { variantPrice, variantTitle, type StudioProduct, type StudioVariant } from '@/lib/studio/types'

export const dynamic = 'force-dynamic'

// Public, no-auth. The QR token in the URL is the sole capability. We resolve either a product token
// or a variant token, and render ONLY public-safe fields (never internal notes / supplier).
async function resolve(token: string): Promise<{ product: StudioProduct; variants: StudioVariant[]; activeVariantId: string | null } | null> {
  const db = createAdminClient()
  let { data: product } = await db.from('studio_products').select('*').eq('qr_token', token).maybeSingle()
  let activeVariantId: string | null = null

  if (!product) {
    const { data: variant } = await db.from('studio_variants').select('*').eq('qr_token', token).maybeSingle()
    if (!variant) return null
    activeVariantId = variant.id
    const { data: p } = await db.from('studio_products').select('*').eq('id', variant.product_id).maybeSingle()
    if (!p) return null
    product = p
  }
  if (product.status === 'archived') return null

  const { data: variants } = await db.from('studio_variants').select('*').eq('product_id', product.id)
    .order('position', { ascending: true }).order('created_at', { ascending: true })
  return { product, variants: variants || [], activeVariantId }
}

const money = (n: number | null) => (n != null ? `$${Number(n).toLocaleString()}` : null)

export default async function PublicProductPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const data = await resolve(token)
  if (!data) notFound()
  const { product, variants, activeVariantId } = data
  const active = variants.find((v) => v.id === activeVariantId) || null
  const price = active ? variantPrice(product, active) : product.base_price
  // A scanned sub-product shows its own photos/description when it has them, else the product's.
  const gallery = (active?.photos?.length ? active.photos : product.photos) || []
  const description = active?.description || product.description
  const fabricSrc = active?.fabric_name ? active : (product.fabric_name ? product : null)
  const fabricLine = fabricSrc
    ? [fabricSrc.fabric_family, fabricSrc.fabric_name, fabricSrc.fabric_composition].filter(Boolean).join(' · ')
    : null

  return (
    <main className="mx-auto min-h-screen max-w-xl bg-white px-4 py-8 text-neutral-900">
      {gallery[0] && (
        <div className="mb-5 overflow-hidden rounded-2xl bg-neutral-100">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={gallery[0]} alt={product.name} className="aspect-square w-full object-cover" />
        </div>
      )}
      {gallery.length > 1 && (
        <div className="mb-5 flex gap-2 overflow-x-auto">
          {gallery.slice(1).map((url, i) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={i} src={url} alt="" className="h-20 w-20 flex-shrink-0 rounded-lg border border-neutral-200 object-cover" />
          ))}
        </div>
      )}

      {product.category && <p className="text-sm font-medium uppercase tracking-wide text-neutral-500">{product.category}</p>}
      <h1 className="mt-1 text-2xl font-bold">{product.name}</h1>
      {active && <p className="mt-1 text-sm font-medium text-neutral-600">{variantTitle(active)}</p>}
      {fabricLine && <p className="mt-0.5 text-sm text-neutral-500">{fabricLine}</p>}
      {money(price) && <p className="mt-2 text-xl font-semibold">{money(price)}</p>}
      {description && <p className="mt-4 whitespace-pre-wrap text-[15px] leading-relaxed text-neutral-700">{description}</p>}

      {Object.keys(product.specs || {}).length > 0 && (
        <dl className="mt-5 divide-y divide-neutral-100 rounded-xl border border-neutral-200">
          {Object.entries(product.specs).map(([k, v]) => (
            <div key={k} className="flex justify-between gap-4 px-4 py-2.5 text-sm">
              <dt className="text-neutral-500">{k}</dt><dd className="text-right font-medium">{v}</dd>
            </div>
          ))}
        </dl>
      )}

      {variants.length > 0 && (
        <section className="mt-6">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-neutral-500">Options</h2>
          <ul className="divide-y divide-neutral-100 rounded-xl border border-neutral-200">
            {variants.map((v) => (
              <li key={v.id} className={`flex items-center justify-between gap-3 px-4 py-3 text-sm ${v.id === activeVariantId ? 'bg-neutral-50' : ''}`}>
                <span className="min-w-0">
                  <span className={`block truncate ${v.id === activeVariantId ? 'font-semibold' : ''}`}>{variantTitle(v)}</span>
                  {v.fabric_name && <span className="block truncate text-xs text-neutral-500">{v.fabric_family} · {v.fabric_name}</span>}
                </span>
                <span className="flex-shrink-0 text-neutral-600">{money(variantPrice(product, v)) || ''}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  )
}
