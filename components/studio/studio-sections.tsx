'use client'

import { useCallback, useEffect, useState } from 'react'
import { Factory, FileText, Receipt, ExternalLink, Download } from 'lucide-react'
import type { StudioProduct, StudioVariant, StudioDocument, StudioDocType } from '@/lib/studio/types'
import { DOC_META, docNumber } from '@/lib/studio/types'
import { FabricPicker, type FabricValue } from '@/components/studio/fabric-picker'
import { VariantsPanel } from '@/components/studio/variants-panel'
import { DocumentCreator } from '@/components/studio/document-creator'

type Qr = { target: string; dataUrl: string | null }

// Drops the full Studio experience (fabric, 3 actions, sub-products, documents, public QR) onto a
// catalog product's page. Resolves the linked studio product by catalog id (created lazily). Renders
// nothing if the studio module is off (403) — the catalog page keeps working as before.
export function StudioSections({ catalogId }: { catalogId: string }) {
  const [product, setProduct] = useState<StudioProduct | null>(null)
  const [variants, setVariants] = useState<StudioVariant[]>([])
  const [documents, setDocuments] = useState<StudioDocument[]>([])
  const [qr, setQr] = useState<Qr | null>(null)
  const [ready, setReady] = useState(false)
  const [docType, setDocType] = useState<StudioDocType | null>(null)

  useEffect(() => {
    fetch(`/api/studio/by-catalog/${catalogId}`).then(async (r) => {
      if (!r.ok) return
      const d = await r.json()
      setProduct(d.product); setVariants(d.variants || []); setDocuments(d.documents || []); setQr(d.qr || null)
    }).finally(() => setReady(true))
  }, [catalogId])

  const reloadDocs = useCallback(() => {
    fetch(`/api/studio/by-catalog/${catalogId}`).then((r) => r.ok && r.json()).then((d) => d && setDocuments(d.documents || [])).catch(() => {})
  }, [catalogId])

  async function saveFabric(fabric: FabricValue) {
    if (!product) return
    const next = { ...product, ...fabric }
    setProduct(next as StudioProduct)
    await fetch(`/api/studio/products/${product.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(next) })
  }

  function downloadQr() {
    if (!qr?.dataUrl) return
    const a = document.createElement('a'); a.href = qr.dataUrl; a.download = `${product?.name || 'product'}-qr.png`; a.click()
  }

  if (!ready || !product) return null
  const fabric: FabricValue = {
    fabric_category: product.fabric_category, fabric_family: product.fabric_family, fabric_name: product.fabric_name,
    fabric_composition: product.fabric_composition, fabric_durability: product.fabric_durability,
  }

  return (
    <div className="mt-4 space-y-4">
      {/* 3 actions */}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <ActionButton icon={<Factory className="h-4 w-4" />} label="Send to production" hint="to supplier" onClick={() => setDocType('production')} />
        <ActionButton icon={<FileText className="h-4 w-4" />} label="Quote" hint="for a client" onClick={() => setDocType('quote')} />
        <ActionButton icon={<Receipt className="h-4 w-4" />} label="Invoice" hint="printable" onClick={() => setDocType('invoice')} />
      </div>

      {/* Fabric */}
      <section className="rounded-xl border border-hairline-strong bg-white p-4">
        <h3 className="mb-2 font-semibold text-ink">Fabric</h3>
        <FabricPicker value={fabric} onChange={saveFabric} />
      </section>

      {/* Sub-products */}
      <VariantsPanel product={product} initial={variants} />

      {/* Documents */}
      {documents.length > 0 && (
        <section className="rounded-xl border border-hairline-strong bg-white p-4">
          <h3 className="mb-2 font-semibold text-ink">Documents</h3>
          <div className="divide-y divide-hairline">
            {documents.map((d) => (
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

      {/* Public customer page + QR */}
      <section className="rounded-xl border border-hairline-strong bg-white p-4">
        <h3 className="mb-2 font-semibold text-ink">Customer page</h3>
        <div className="flex items-center gap-4">
          {qr?.dataUrl
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={qr.dataUrl} alt="Customer QR" className="h-24 w-24 rounded-lg border border-hairline" />
            : <span className="flex h-24 w-24 items-center justify-center rounded-lg border border-hairline text-xs text-muted">QR n/a</span>}
          <div className="space-y-2">
            <p className="text-xs text-muted">The public, customer-facing product page (separate from the staff QR below).</p>
            <div className="flex flex-wrap gap-2">
              <button onClick={downloadQr} className="inline-flex items-center gap-1.5 rounded-lg border border-hairline-strong px-3 py-1.5 text-sm font-medium text-ink hover:bg-sunken"><Download className="h-4 w-4" /> Download</button>
              {qr?.target && <a href={qr.target} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-lg border border-hairline-strong px-3 py-1.5 text-sm font-medium text-ink hover:bg-sunken"><ExternalLink className="h-4 w-4" /> View</a>}
            </div>
          </div>
        </div>
      </section>

      {docType && <DocumentCreator product={product} variants={variants} type={docType} onClose={() => { setDocType(null); reloadDocs() }} />}
    </div>
  )
}

function ActionButton({ icon, label, hint, onClick }: { icon: React.ReactNode; label: string; hint: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="flex items-center gap-2 rounded-xl border border-hairline-strong bg-white px-4 py-3 text-left transition hover:border-accent hover:shadow-sm">
      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-sunken text-ink">{icon}</span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-ink">{label}</span>
        <span className="block text-xs text-muted">{hint}</span>
      </span>
    </button>
  )
}
