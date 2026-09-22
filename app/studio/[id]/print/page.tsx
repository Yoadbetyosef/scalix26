import { notFound } from 'next/navigation'
import { headers } from 'next/headers'
import Link from 'next/link'
import { createAdminClient } from '@/lib/supabase/server'
import { requireStudioTenant } from '@/lib/studio/session'
import { publicProductUrl, qrDataUrl } from '@/lib/studio/qr'
import { PrintButton } from '@/components/studio/print-button'

export const dynamic = 'force-dynamic'

/**
 * The showroom tag: one QR per sheet, to cut out and attach to the piece.
 *
 * STAFF-ONLY PAGE, CUSTOMER-ONLY LINK. It sits under /studio so the layout's auth + module gate
 * applies, and it re-checks requireStudioTenant() and scopes the read by tenant_id — a product id
 * belonging to another business resolves to nothing. What it PRINTS, though, is only ever
 * publicProductUrl(qr_token): the staff URL (/catalog/<id>, /studio/<id>) must never reach a tag
 * that a customer will hold, and the catalog page carries a second, staff-facing QR that is easy to
 * confuse with this one.
 *
 * Everything on the sheet is either the code, the name, or the SKU. No price (tags outlive prices),
 * no controls (print:hidden), no platform branding — the tenant's customer is not our customer.
 */
export default async function ProductTagPage({ params }: { params: Promise<{ id: string }> }) {
  const s = await requireStudioTenant()
  if (!s) notFound()
  const { id } = await params

  const db = createAdminClient()
  const { data: product } = await db.from('studio_products')
    .select('id, name, qr_token, catalog_product_id')
    .eq('id', id).eq('tenant_id', s.tenantId).maybeSingle()
  if (!product) notFound()

  // The SKU lives on the linked catalog product — studio_products has none of its own.
  let sku: string | null = null
  if (product.catalog_product_id) {
    const { data: cat } = await db.from('catalog_products')
      .select('sku').eq('id', product.catalog_product_id).eq('tenant_id', s.tenantId).maybeSingle()
    sku = cat?.sku ?? null
  }

  const h = await headers()
  const host = h.get('host')
  const origin = host ? `${h.get('x-forwarded-proto') || 'https'}://${host}` : null
  const target = publicProductUrl(product.qr_token, origin)
  const dataUrl = await qrDataUrl(target, 900)

  return (
    <main className="mx-auto max-w-xl px-4 py-8 print:max-w-none print:p-0">
      <div className="mb-6 flex items-center justify-between gap-3 print:hidden">
        <Link href={`/studio/${product.id}`} className="text-sm text-neutral-500 underline">Back to the product</Link>
        <PrintButton />
      </div>

      <div className="mx-auto flex w-full max-w-sm flex-col items-center rounded-2xl border border-neutral-300 bg-white p-8 text-center text-neutral-900 print:h-[100vh] print:max-w-none print:justify-center print:rounded-none print:border-0">
        {dataUrl
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={dataUrl} alt={`QR code that opens the customer page for ${product.name}`} className="h-56 w-56 print:h-80 print:w-80" />
          : <p className="text-sm text-neutral-500">The code could not be drawn — reload to try again.</p>}

        <h1 className="mt-6 text-xl font-bold leading-snug print:text-2xl">{product.name}</h1>
        {sku && <p className="mt-2 text-sm tracking-wide text-neutral-600 print:text-base">{sku}</p>}
        <p className="mt-4 text-xs text-neutral-400 print:hidden">Scan opens the customer page.</p>
      </div>

      {/* The link itself, for checking the tag before it is printed. Never on the sheet. */}
      <p className="mt-4 break-all text-center text-xs text-neutral-400 print:hidden">{target}</p>
    </main>
  )
}
