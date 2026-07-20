import { notFound } from 'next/navigation'
import Link from 'next/link'
import { resolveQrToken } from '@/lib/core/public-qr'

export const dynamic = 'force-dynamic'

// PUBLIC QR page — target of a product component / variant QR. No auth: looked up by the unguessable token.
// Customer-safe fields only. Clearly shows which LEVEL is being viewed (component vs variant) and its parent.
const AV: Record<string, { label: string; cls: string }> = {
  active: { label: 'Available', cls: 'bg-emerald-100 text-emerald-800' },
  inactive: { label: 'Unavailable', cls: 'bg-red-100 text-red-800' },
  discontinued: { label: 'Discontinued', cls: 'bg-gray-100 text-gray-700' },
}
const money = (cents: number | null, currency: string) => (cents == null ? null : (cents / 100).toLocaleString(undefined, { style: 'currency', currency: currency || 'usd' }))

export default async function PublicQrPage({ params }: { params: Promise<{ token: string }> }) {
  const q = await resolveQrToken((await params).token)
  if (!q) notFound()
  const av = AV[q.status] ?? AV.active
  const price = money(q.price_cents, q.currency)
  const levelLabel = q.level === 'variant' ? `Variant of ${q.parentName ?? q.productName ?? 'product'}` : q.productName ? `Component of ${q.productName}` : 'Component'

  return (
    <main className="min-h-screen bg-gray-50 px-4 py-10 text-gray-900">
      <div className="mx-auto max-w-md overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
        {q.image_url
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={q.image_url} alt={q.name} className="h-64 w-full object-cover" />
          : <div className="flex h-40 w-full items-center justify-center bg-gray-100 text-gray-400">No photo</div>}
        <div className="p-5">
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-indigo-700">{q.level}</span>
            <p className="truncate text-xs uppercase tracking-wide text-gray-400">{levelLabel}</p>
          </div>
          <h1 className="mt-1 text-2xl font-bold">{q.name}</h1>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <span className={`rounded-full px-2.5 py-1 text-sm font-medium ${av.cls}`}>{av.label}</span>
            {price && <span className="text-xl font-semibold">{price}</span>}
          </div>

          <dl className="mt-4 space-y-2 text-sm">
            {q.sku && <Row k="SKU" v={q.sku} />}
            {q.category && <Row k="Category" v={q.category} />}
            {q.attributes.map((a) => <Row key={a.key} k={a.label} v={a.display} />)}
          </dl>

          {q.variants.length > 0 && (
            <div className="mt-5 border-t border-gray-100 pt-4">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">Options</p>
              <ul className="space-y-1.5">
                {q.variants.map((v) => (
                  <li key={v.token}>
                    <Link href={`/p/${v.token}`} className="flex items-center justify-between rounded-lg border border-gray-200 px-3 py-2 text-sm hover:bg-gray-50">
                      <span className="min-w-0 truncate">{v.name}{v.sku ? <span className="text-gray-400"> · {v.sku}</span> : null}</span>
                      {money(v.price_cents, v.currency) && <span className="shrink-0 font-medium">{money(v.price_cents, v.currency)}</span>}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </main>
  )
}

function Row({ k, v }: { k: string; v: string }) {
  return <div className="flex justify-between gap-3"><dt className="text-gray-500">{k}</dt><dd className="text-right font-medium text-gray-900">{v}</dd></div>
}
