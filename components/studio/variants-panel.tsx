'use client'

import { useState } from 'react'
import { Plus, Trash2, Pencil, QrCode, Download, ExternalLink } from 'lucide-react'
import type { StudioProduct, StudioVariant } from '@/lib/studio/types'
import { variantPrice, variantTitle } from '@/lib/studio/types'
import { SubProductForm } from '@/components/studio/sub-product-form'
import { ProductCostCard } from '@/components/catalog/product-cost-card'
import { useConfirm } from '@/components/v2/confirm'

export function VariantsPanel({ product, initial }: { product: StudioProduct; initial: StudioVariant[] }) {
  const [variants, setVariants] = useState<StudioVariant[]>(initial)
  const [adding, setAdding] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [qrFor, setQrFor] = useState<string | null>(null)
  const [qr, setQr] = useState<{ target: string; dataUrl: string | null } | null>(null)
  const { ask, dialog } = useConfirm()

  async function toggleQr(id: string, name: string) {
    if (qrFor === id) { setQrFor(null); return }
    setQrFor(id); setQr(null)
    const res = await fetch(`/api/studio/variants/${id}/qr`)
    if (res.ok) setQr({ ...(await res.json()), name } as { target: string; dataUrl: string | null })
  }
  function downloadQr(name: string) {
    if (!qr?.dataUrl) return
    const a = document.createElement('a'); a.href = qr.dataUrl; a.download = `${name}-qr.png`; a.click()
  }

  async function create(payload: Record<string, unknown>) {
    const res = await fetch(`/api/studio/products/${product.id}/variants`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...payload, position: variants.length }),
    })
    const d = await res.json()
    if (!res.ok) throw new Error(d.error || 'Failed')
    setVariants((v) => [...v, d.variant]); setAdding(false)
  }

  async function update(id: string, payload: Record<string, unknown>) {
    const res = await fetch(`/api/studio/variants/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    })
    const d = await res.json()
    if (!res.ok) throw new Error(d.error || 'Failed')
    setVariants((v) => v.map((x) => (x.id === id ? d.variant : x))); setEditingId(null)
  }

  async function remove(id: string, name: string) {
    if (!(await ask({
      title: 'Delete sub-product',
      body: <>Deleting <b>{name}</b> removes it and its public page. The product it belongs to is untouched.</>,
      confirmLabel: 'Delete sub-product',
      danger: true,
    }))) return
    setVariants((v) => v.filter((x) => x.id !== id))
    await fetch(`/api/studio/variants/${id}`, { method: 'DELETE' })
  }

  return (
    <section style={{ marginTop: 30 }}>
      {dialog}
      <div className="v2-head">
        <p className="v2-kick" style={{ ['--ghue' as string]: 'var(--v2-t2)' }}><i />Sub-products · {variants.length}</p>
        <s />
        {!adding && <button onClick={() => { setAdding(true); setEditingId(null) }} className="v2-act tap-target" style={{ ['--ghue' as string]: 'var(--v2-t2)' }}><Plus className="w-3.5 h-3.5" /> Add sub-product</button>}
      </div>

      {variants.length === 0 && !adding && (
        <div className="v2-card" data-empty>
          <b>No sub-products</b>
          <span>The product sells as-is at its base price. Add one for a version that differs in fabric, size or finish.</span>
        </div>
      )}

      {variants.length > 0 && (
        <div className="v2-list">
          {variants.map((v) => {
            const price = variantPrice(product, v)
            const cover = v.photos?.[0] || product.photos?.[0]
            const title = variantTitle(v)
            if (editingId === v.id) {
              return (
                <div key={v.id} style={{ padding: '16px 0' }}>
                  <SubProductForm initial={v} submitLabel="Save" onCancel={() => setEditingId(null)} onSubmit={(p) => update(v.id, p)} />
                </div>
              )
            }
            return (
              <div key={v.id}>
                <div className="v2-row" style={{ ['--chan' as string]: 'var(--v2-t2)', borderBottom: 0 }}>
                  <span className="v2-shot" style={{ ['--shot' as string]: '48px' }}>
                    {cover
                      // eslint-disable-next-line @next/next/no-img-element
                      ? <img src={cover} alt="" />
                      : <i><QrCode /></i>}
                  </span>
                  <div className="v2-m">
                    <p><span className="truncate">{title}</span></p>
                    <span>
                      {v.fabric_name ? `${v.fabric_family} · ${v.fabric_name}` : 'No fabric'}
                      {price != null ? ` · $${Number(price).toLocaleString()}` : ''}
                    </span>
                  </div>
                  <div className="flex items-center gap-1 flex-none">
                    <button onClick={() => toggleQr(v.id, title)} title="QR code" aria-label={`Show the QR code for ${title}`} className="v2-ico" style={{ ['--ghue' as string]: qrFor === v.id ? 'var(--v2-t2)' : 'var(--v2-mute)' }}><QrCode /></button>
                    <button onClick={() => { setEditingId(v.id); setAdding(false) }} title="Edit" aria-label={`Edit ${title}`} className="v2-ico"><Pencil /></button>
                    <button onClick={() => remove(v.id, title)} title="Delete" aria-label={`Delete ${title}`} className="v2-ico" style={{ ['--ghue' as string]: 'var(--v2-red)' }}><Trash2 /></button>
                  </div>
                </div>

                {/* This sub-product's own cost, measured against its own price — the same card the
                    product uses, not a copy of it. Renders nothing when the session may not see costs. */}
                <div style={{ padding: '0 16px 14px' }}>
                  <ProductCostCard variantId={v.id} compact />
                </div>

                {qrFor === v.id && (
                  <div style={{ padding: '0 16px 18px' }}>
                    <div className="v2-shots">
                      <div className="v2-shot" data-code>
                        <b>Its own scan</b>
                        {qr?.dataUrl
                          // eslint-disable-next-line @next/next/no-img-element
                          ? <img src={qr.dataUrl} alt={`QR code for ${title}`} />
                          : <i><QrCode /></i>}
                        <span>This sub-product’s own public page.</span>
                        <span className="v2-bar">
                          <button onClick={() => downloadQr(title)} disabled={!qr?.dataUrl} className="v2-act tap-target"><Download className="w-3.5 h-3.5" /> Download</button>
                          {qr?.target && <a href={qr.target} target="_blank" rel="noreferrer" className="v2-act tap-target"><ExternalLink className="w-3.5 h-3.5" /> View</a>}
                        </span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {adding && (
        <div style={{ marginTop: 18 }}>
          <SubProductForm submitLabel="Add sub-product" onCancel={() => setAdding(false)} onSubmit={create} />
        </div>
      )}
    </section>
  )
}
