'use client'

import { useState } from 'react'
import { Plus, Trash2, Pencil, QrCode, Download, ExternalLink } from 'lucide-react'
import type { StudioProduct, StudioVariant } from '@/lib/studio/types'
import { variantPrice, variantTitle } from '@/lib/studio/types'
import { SubProductForm } from '@/components/studio/sub-product-form'

export function VariantsPanel({ product, initial }: { product: StudioProduct; initial: StudioVariant[] }) {
  const [variants, setVariants] = useState<StudioVariant[]>(initial)
  const [adding, setAdding] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [qrFor, setQrFor] = useState<string | null>(null)
  const [qr, setQr] = useState<{ target: string; dataUrl: string | null } | null>(null)

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

  async function remove(id: string) {
    if (!confirm('Delete this sub-product?')) return
    setVariants((v) => v.filter((x) => x.id !== id))
    await fetch(`/api/studio/variants/${id}`, { method: 'DELETE' })
  }

  return (
    <section className="rounded-xl border border-hairline-strong bg-white p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-semibold text-ink">Sub-products <span className="text-sm font-normal text-muted">({variants.length})</span></h3>
        {!adding && <button onClick={() => { setAdding(true); setEditingId(null) }} className="inline-flex items-center gap-1 text-sm font-medium text-accent"><Plus className="h-4 w-4" /> Add sub-product</button>}
      </div>

      {variants.length === 0 && !adding && <p className="text-sm text-muted">No sub-products yet — the product sells as-is at its base price.</p>}

      {variants.length > 0 && (
        <div className="divide-y divide-hairline">
          {variants.map((v) => {
            const price = variantPrice(product, v)
            const cover = v.photos?.[0] || product.photos?.[0]
            if (editingId === v.id) {
              return (
                <div key={v.id} className="py-3">
                  <SubProductForm initial={v} submitLabel="Save" onCancel={() => setEditingId(null)} onSubmit={(p) => update(v.id, p)} />
                </div>
              )
            }
            const title = variantTitle(v)
            return (
              <div key={v.id} className="py-2.5">
                <div className="flex items-center gap-3">
                  <div className="h-12 w-12 flex-shrink-0 overflow-hidden rounded-lg border border-hairline bg-sunken">
                    {cover
                      // eslint-disable-next-line @next/next/no-img-element
                      ? <img src={cover} alt="" className="h-full w-full object-cover" />
                      : <span className="flex h-full w-full items-center justify-center text-[10px] text-muted">—</span>}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-ink">{title}</p>
                    <p className="truncate text-xs text-muted">
                      {v.fabric_name ? `${v.fabric_family} · ${v.fabric_name}` : 'No fabric'}
                      {price != null ? ` · $${Number(price).toLocaleString()}` : ''}
                    </p>
                  </div>
                  <button onClick={() => toggleQr(v.id, title)} title="QR code" className={`flex-shrink-0 rounded-lg p-2 hover:bg-sunken ${qrFor === v.id ? 'text-accent' : 'text-muted hover:text-ink'}`}><QrCode className="h-4 w-4" /></button>
                  <button onClick={() => { setEditingId(v.id); setAdding(false) }} className="flex-shrink-0 rounded-lg p-2 text-muted hover:bg-sunken hover:text-ink"><Pencil className="h-4 w-4" /></button>
                  <button onClick={() => remove(v.id)} className="flex-shrink-0 rounded-lg p-2 text-muted hover:bg-sunken hover:text-red-600"><Trash2 className="h-4 w-4" /></button>
                </div>
                {qrFor === v.id && (
                  <div className="mt-2 flex items-center gap-4 rounded-lg border border-hairline bg-sunken/40 p-3">
                    {qr?.dataUrl
                      // eslint-disable-next-line @next/next/no-img-element
                      ? <img src={qr.dataUrl} alt="QR" className="h-24 w-24 rounded-lg border border-hairline bg-white" />
                      : <span className="flex h-24 w-24 items-center justify-center rounded-lg border border-hairline text-xs text-muted">…</span>}
                    <div className="space-y-2">
                      <p className="text-xs text-muted">This sub-product’s own public page.</p>
                      <div className="flex flex-wrap gap-2">
                        <button onClick={() => downloadQr(title)} disabled={!qr?.dataUrl} className="inline-flex items-center gap-1.5 rounded-lg border border-hairline-strong px-3 py-1.5 text-sm font-medium text-ink hover:bg-white disabled:opacity-50"><Download className="h-4 w-4" /> Download</button>
                        {qr?.target && <a href={qr.target} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-lg border border-hairline-strong px-3 py-1.5 text-sm font-medium text-ink hover:bg-white"><ExternalLink className="h-4 w-4" /> View</a>}
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
        <div className="mt-3">
          <SubProductForm submitLabel="Add sub-product" onCancel={() => setAdding(false)} onSubmit={create} />
        </div>
      )}
    </section>
  )
}
