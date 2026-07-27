'use client'

import { useCallback, useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { Download, ExternalLink, Factory, FileText, Receipt, Pencil, Trash2 } from 'lucide-react'
import { ProductForm } from '@/components/studio/product-form'
import { VariantsPanel } from '@/components/studio/variants-panel'
import { DocumentCreator } from '@/components/studio/document-creator'
import type { StudioProduct, StudioVariant, StudioDocType, StudioDocument } from '@/lib/studio/types'
import { DOC_META, docNumber } from '@/lib/studio/types'

type Qr = { target: string; dataUrl: string | null }

export default function StudioProductPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const [product, setProduct] = useState<StudioProduct | null>(null)
  const [variants, setVariants] = useState<StudioVariant[]>([])
  const [qr, setQr] = useState<Qr | null>(null)
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(false)
  const [docType, setDocType] = useState<StudioDocType | null>(null)
  const [docs, setDocs] = useState<StudioDocument[]>([])

  const loadDocs = useCallback(() => {
    fetch(`/api/studio/products/${id}/documents`).then((r) => r.json()).then((d) => setDocs(d.documents || [])).catch(() => {})
  }, [id])

  useEffect(() => {
    fetch(`/api/studio/products/${id}`).then((r) => r.json()).then((d) => {
      setProduct(d.product || null); setVariants(d.variants || []); setQr(d.qr || null); setLoading(false)
    }).catch(() => setLoading(false))
    loadDocs()
  }, [id, loadDocs])

  async function save(payload: Record<string, unknown>) {
    const res = await fetch(`/api/studio/products/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
    const d = await res.json()
    if (!res.ok) throw new Error(d.error || 'Failed to save')
    setProduct(d.product); setEditing(false)
  }
  async function del() {
    if (!confirm('Delete this product and all its variants?')) return
    await fetch(`/api/studio/products/${id}`, { method: 'DELETE' })
    router.push('/studio')
  }
  function downloadQr() {
    if (!qr?.dataUrl) return
    const a = document.createElement('a'); a.href = qr.dataUrl; a.download = `${product?.name || 'product'}-qr.png`; a.click()
  }

  if (loading) return <div className="mx-auto max-w-3xl p-6 text-sm text-muted">Loading…</div>
  if (!product) return <div className="mx-auto max-w-3xl p-6"><Link href="/studio" className="text-sm text-accent">← Catalog</Link><p className="mt-4 text-sm text-muted">Product not found.</p></div>

  if (editing) {
    return (
      <div className="mx-auto max-w-2xl p-4 sm:p-6">
        <button onClick={() => setEditing(false)} className="text-sm text-subtle hover:text-ink">← Cancel</button>
        <h1 className="mb-4 mt-2 text-2xl font-bold text-ink">Edit product</h1>
        <ProductForm initial={product} onSubmit={save} submitLabel="Save changes" />
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-3xl p-4 sm:p-6">
      <div className="flex items-center justify-between">
        <Link href="/studio" className="text-sm text-subtle hover:text-ink">← Catalog</Link>
        <div className="flex gap-2">
          <button onClick={() => setEditing(true)} className="inline-flex items-center gap-1.5 rounded-lg border border-hairline-strong px-3 py-1.5 text-sm font-medium text-ink hover:bg-sunken"><Pencil className="h-4 w-4" /> Edit</button>
          <button onClick={del} className="inline-flex items-center gap-1.5 rounded-lg border border-hairline-strong px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50"><Trash2 className="h-4 w-4" /></button>
        </div>
      </div>

      {/* Header: cover + basics */}
      <div className="mt-3 flex flex-col gap-4 sm:flex-row">
        <div className="h-40 w-40 flex-shrink-0 overflow-hidden rounded-xl border border-hairline bg-sunken">
          {product.photos?.[0]
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={product.photos[0]} alt="" className="h-full w-full object-cover" />
            : <span className="flex h-full w-full items-center justify-center text-xs text-muted">No photo</span>}
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-bold text-ink">{product.name}</h1>
          {product.category && <p className="text-sm text-muted">{product.category}</p>}
          <p className="mt-1 text-lg font-semibold text-ink">{product.base_price != null ? `$${Number(product.base_price).toLocaleString()}` : '—'}</p>
          {product.fabric_name && (
            <p className="mt-1 text-sm text-subtle">
              <span className="font-medium text-ink">{product.fabric_family} · {product.fabric_name}</span>
              {product.fabric_composition ? ` — ${product.fabric_composition}` : ''}
            </p>
          )}
          {product.description && <p className="mt-2 whitespace-pre-wrap text-sm text-subtle">{product.description}</p>}
        </div>
      </div>

      {/* The 3 actions — the heart of the product hub */}
      <div className="mt-5 grid grid-cols-1 gap-2 sm:grid-cols-3">
        <ActionButton icon={<Factory className="h-4 w-4" />} label="Send to production" hint="to supplier" onClick={() => setDocType('production')} />
        <ActionButton icon={<FileText className="h-4 w-4" />} label="Quote" hint="for a client" onClick={() => setDocType('quote')} />
        <ActionButton icon={<Receipt className="h-4 w-4" />} label="Invoice" hint="printable" onClick={() => setDocType('invoice')} />
      </div>

      {/* Variants */}
      <div className="mt-5"><VariantsPanel product={product} initial={variants} /></div>

      {/* Documents issued from this product */}
      {docs.length > 0 && (
        <section className="mt-5 rounded-xl border border-hairline-strong bg-white p-4">
          <h3 className="mb-2 font-semibold text-ink">Documents</h3>
          <div className="divide-y divide-hairline">
            {docs.map((d) => (
              <a key={d.id} href={`/d/${d.token}`} target="_blank" rel="noreferrer" className="flex items-center justify-between py-2.5 hover:opacity-70">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-ink">{DOC_META[d.type].title} <span className="font-normal text-muted">#{docNumber(d)}</span></p>
                  <p className="text-xs text-muted">{[d.party_name, new Date(d.created_at).toISOString().slice(0, 10)].filter(Boolean).join(' · ')}</p>
                </div>
                <span className="flex-shrink-0 text-sm font-medium text-ink">{d.type !== 'production' ? `$${Number(d.subtotal).toLocaleString()}` : `${d.line_items.length} items`}</span>
              </a>
            ))}
          </div>
        </section>
      )}

      {docType && <DocumentCreator product={product} variants={variants} type={docType} onClose={() => { setDocType(null); loadDocs() }} />}

      {/* QR / public page */}
      <section className="mt-5 rounded-xl border border-hairline-strong bg-white p-4">
        <h3 className="mb-2 font-semibold text-ink">Public page & QR</h3>
        <div className="flex items-center gap-4">
          {qr?.dataUrl
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={qr.dataUrl} alt="Product QR" className="h-28 w-28 rounded-lg border border-hairline" />
            : <span className="flex h-28 w-28 items-center justify-center rounded-lg border border-hairline text-xs text-muted">QR n/a</span>}
          <div className="space-y-2">
            <p className="text-sm text-muted">Scanning the QR opens the public product page.</p>
            <div className="flex flex-wrap gap-2">
              <button onClick={downloadQr} className="inline-flex items-center gap-1.5 rounded-lg border border-hairline-strong px-3 py-1.5 text-sm font-medium text-ink hover:bg-sunken"><Download className="h-4 w-4" /> Download QR</button>
              {qr?.target && <a href={qr.target} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-lg border border-hairline-strong px-3 py-1.5 text-sm font-medium text-ink hover:bg-sunken"><ExternalLink className="h-4 w-4" /> View page</a>}
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}

function ActionButton({ icon, label, hint, onClick }: { icon: React.ReactNode; label: string; hint: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-2 rounded-xl border border-hairline-strong bg-white px-4 py-3 text-left transition hover:border-accent hover:shadow-sm"
    >
      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-sunken text-ink">{icon}</span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-ink">{label}</span>
        <span className="block text-xs text-muted">{hint}</span>
      </span>
    </button>
  )
}
