'use client'

import { useCallback, useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { Download, ExternalLink, Factory, FileText, Receipt, Pencil, Trash2, ChevronLeft, QrCode, Image as ImageIcon } from 'lucide-react'
import { ProductForm } from '@/components/studio/product-form'
import { useConfirm } from '@/components/v2/confirm'
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
  const { ask, dialog } = useConfirm()

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
    if (!(await ask({
      title: 'Delete product',
      body: <>Deleting <b>{product?.name || 'this product'}</b> also removes its sub-products, its documents and its public page. This cannot be undone.</>,
      confirmLabel: 'Delete product',
      danger: true,
    }))) return
    await fetch(`/api/studio/products/${id}`, { method: 'DELETE' })
    router.push('/studio')
  }
  function downloadQr() {
    if (!qr?.dataUrl) return
    const a = document.createElement('a'); a.href = qr.dataUrl; a.download = `${product?.name || 'product'}-qr.png`; a.click()
  }

  if (loading) return <div className="v2 v2-embedded p-4 sm:p-6"><p className="v2-kick">Loading…</p></div>
  if (!product) return (
    <div className="v2 v2-embedded mx-auto max-w-3xl p-4 sm:p-6">
      <div className="v2-card" data-empty>
        <b>That product isn’t here</b>
        <span>It may have been deleted. <Link href="/studio" style={{ color: 'var(--v2-ink)', textDecoration: 'underline' }}>Back to the studio</Link>.</span>
      </div>
    </div>
  )

  if (editing) {
    return (
      <div className="v2 v2-embedded mx-auto max-w-2xl p-4 sm:p-6">
        <div className="v2-head">
          <button onClick={() => setEditing(false)} className="v2-act tap-target"><ChevronLeft className="w-3.5 h-3.5" /> Cancel</button>
          <p className="v2-kick" style={{ ['--ghue' as string]: 'var(--v2-t2)' }}><i />Editing {product.name}</p>
          <s />
        </div>
        <ProductForm initial={product} onSubmit={save} submitLabel="Save changes" />
      </div>
    )
  }

  return (
    <div className="v2 v2-embedded mx-auto max-w-3xl p-4 sm:p-6" style={{ paddingBottom: 'calc(24px + var(--v2-grab-h))' }}>
      {dialog}
      <div className="v2-head">
        <Link href="/studio" className="v2-act tap-target"><ChevronLeft className="w-3.5 h-3.5" /> Studio</Link>
        <s />
        <button onClick={() => setEditing(true)} className="v2-act tap-target" data-solid style={{ ['--ghue' as string]: 'var(--v2-t2)' }}><Pencil className="w-3.5 h-3.5" /> Edit</button>
        <button onClick={del} className="v2-ico" style={{ ['--ghue' as string]: 'var(--v2-red)' }} title="Delete" aria-label={`Delete ${product.name}`}><Trash2 /></button>
      </div>

      {/* The photograph and the code on one baseline — the same media block /catalog/[id] uses. §35. */}
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', gap: 20, marginBottom: 26 }}>
        <div className="v2-shots">
          <div className="v2-shot">
            <b>Photo</b>
            {product.photos?.[0]
              // eslint-disable-next-line @next/next/no-img-element
              ? <img src={product.photos[0]} alt={product.name} />
              : <i><ImageIcon /></i>}
          </div>
          <div className="v2-shot" data-code>
            <b>Scan</b>
            {qr?.dataUrl
              // eslint-disable-next-line @next/next/no-img-element
              ? <img src={qr.dataUrl} alt={`QR code for ${product.name}`} />
              : <i><QrCode /></i>}
            <span>Opens the public product page.</span>
            <span className="v2-bar">
              <button onClick={downloadQr} className="v2-act tap-target"><Download className="w-3.5 h-3.5" /> Download</button>
              {qr?.target && <a href={qr.target} target="_blank" rel="noreferrer" className="v2-act tap-target"><ExternalLink className="w-3.5 h-3.5" /> View</a>}
            </span>
          </div>
        </div>

        <div style={{ flex: 1, minWidth: 220 }}>
          <h1 style={{ fontSize: 24, fontWeight: 650, letterSpacing: '-0.02em', lineHeight: 1.15, color: 'var(--v2-ink)' }}>{product.name}</h1>
          {product.category && <p className="v2-kick" style={{ marginTop: 8 }}>{product.category}</p>}
          <p style={{ marginTop: 10, fontSize: 17, fontWeight: 600, color: 'var(--v2-ink)', fontVariantNumeric: 'tabular-nums' }}>
            {product.base_price != null ? `$${Number(product.base_price).toLocaleString()}` : '—'}
          </p>
          {product.description && <p style={{ marginTop: 12, fontSize: 14.5, lineHeight: 1.5, color: 'var(--v2-ink-72)', whiteSpace: 'pre-wrap' }}>{product.description}</p>}
          {product.fabric_name && (
            <dl className="v2-facts" data-narrow style={{ marginTop: 16 }}>
              <div>
                <dt>Fabric</dt>
                <dd>{[product.fabric_family, product.fabric_name].filter(Boolean).join(' · ')}{product.fabric_composition ? ` — ${product.fabric_composition}` : ''}</dd>
              </div>
            </dl>
          )}
        </div>
      </div>

      {/* The three studio verbs, on one bar — the same three /catalog/[id] carries. */}
      <div className="v2-head">
        <p className="v2-kick" style={{ ['--ghue' as string]: 'var(--v2-t2)' }}><i />Studio</p><s />
      </div>
      <div className="v2-bar">
        <button type="button" onClick={() => setDocType('production')} className="v2-act tap-target" style={{ ['--ghue' as string]: 'var(--v2-t2)' }}><Factory className="w-3.5 h-3.5" /> Send to production</button>
        <button type="button" onClick={() => setDocType('quote')} className="v2-act tap-target" style={{ ['--ghue' as string]: 'var(--v2-t2)' }}><FileText className="w-3.5 h-3.5" /> Quote</button>
        <button type="button" onClick={() => setDocType('invoice')} className="v2-act tap-target" style={{ ['--ghue' as string]: 'var(--v2-t2)' }}><Receipt className="w-3.5 h-3.5" /> Invoice</button>
      </div>

      <VariantsPanel product={product} initial={variants} />

      {docs.length > 0 && (
        <section style={{ marginTop: 30 }}>
          <div className="v2-head"><p className="v2-kick" style={{ ['--ghue' as string]: 'var(--v2-t3)' }}><i />Documents · {docs.length}</p><s /></div>
          <div className="v2-list">
            {docs.map((d) => (
              <a key={d.id} href={`/d/${d.token}`} target="_blank" rel="noreferrer" className="v2-row tap-target" data-click style={{ ['--chan' as string]: 'var(--v2-t3)' }}>
                <div className="v2-m">
                  <p><span className="truncate">{DOC_META[d.type].title}</span><span className="v2-stat">#{docNumber(d)}</span></p>
                  <span>{[d.party_name, new Date(d.created_at).toISOString().slice(0, 10)].filter(Boolean).join(' · ')}</span>
                </div>
                <div className="v2-meta">
                  <em style={{ fontVariantNumeric: 'tabular-nums' }}>{d.type !== 'production' ? `$${Number(d.subtotal).toLocaleString()}` : `${d.line_items.length} items`}</em>
                </div>
              </a>
            ))}
          </div>
        </section>
      )}

      {docType && <DocumentCreator product={product} variants={variants} type={docType} onClose={() => { setDocType(null); loadDocs() }} />}
    </div>
  )
}
