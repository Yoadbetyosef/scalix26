'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Download, ExternalLink, Factory, FileText, Pencil, Printer, QrCode, Receipt } from 'lucide-react'
import type { StudioProduct, StudioVariant, StudioDocument, StudioDocType } from '@/lib/studio/types'
import { DOC_META, docNumber } from '@/lib/studio/types'
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

  function downloadQr() {
    if (!qr?.dataUrl) return
    const a = document.createElement('a'); a.href = qr.dataUrl; a.download = `${product?.name || 'product'}-qr.png`; a.click()
  }

  if (!ready || !product) return null

  return (
    <div style={{ marginTop: 30 }}>
      {/* THE THREE STUDIO VERBS. Three bordered cards with an icon tile each became three pills on
          one bar — the same action bar every other detail screen uses. The hint each carried ("to
          supplier", "for a client", "printable") is the sub-line of a card, and these are not cards
          any more; production goes to a supplier and a quote goes to a client whichever way you say
          it, so the words go rather than being kept as a caption under a pill. */}
      <div className="v2-head">
        <p className="v2-kick" style={{ ['--ghue' as string]: 'var(--v2-t2)' }}><i />Studio</p><s />
        {/* The way through to the Studio product itself. Its absence was a dead end: this block is
            the ONLY place a catalog product admits a studio counterpart exists, and the photo list,
            the cover and the description that the customer's scanned page renders are all edited
            over there — reachable until now only by finding the piece again in the Studio list.
            STAFF-ONLY, like the rest of this component, which renders nothing at all when the
            studio module is off or the session cannot see it (the fetch 403s and `product` stays
            null). The customer's page and its QR are untouched by this link. */}
        <Link href={`/studio/${product.id}`} className="v2-act tap-target" style={{ ['--ghue' as string]: 'var(--v2-t2)' }}>
          <Pencil className="w-3.5 h-3.5" /> Open in Studio
        </Link>
      </div>
      <div className="v2-bar">
        <button type="button" onClick={() => setDocType('production')} className="v2-act tap-target" style={{ ['--ghue' as string]: 'var(--v2-t2)' }}><Factory className="w-3.5 h-3.5" /> Send to production</button>
        <button type="button" onClick={() => setDocType('quote')} className="v2-act tap-target" style={{ ['--ghue' as string]: 'var(--v2-t2)' }}><FileText className="w-3.5 h-3.5" /> Quote</button>
        <button type="button" onClick={() => setDocType('invoice')} className="v2-act tap-target" style={{ ['--ghue' as string]: 'var(--v2-t2)' }}><Receipt className="w-3.5 h-3.5" /> Invoice</button>
      </div>

      {/* Sub-products */}
      <VariantsPanel product={product} initial={variants} />

      {/* Documents */}
      {documents.length > 0 && (
        <section style={{ marginTop: 30 }}>
          <div className="v2-head"><p className="v2-kick" style={{ ['--ghue' as string]: 'var(--v2-t3)' }}><i />Documents · {documents.length}</p><s /></div>
          <div className="v2-list">
            {documents.map((d) => (
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

      {/* THE CUSTOMER'S CODE. Same block as the staff one at the top of the page, which is exactly
          why it has to say which is which: two identical QR frames on one screen that open different
          pages is the one confusion this section can cause. The micro-label does that job. */}
      <section style={{ marginTop: 30 }}>
        <div className="v2-head"><p className="v2-kick" style={{ ['--ghue' as string]: 'var(--v2-t4)' }}><i />Customer page</p><s /></div>
        <div className="v2-shots">
          <div className="v2-shot" data-code>
            <b>Customer scan</b>
            {/* THE CODE IS THE WAY IN. Clicking it opens the very page the customer's phone opens —
                which, for a signed-in member of this business, carries the staff editing panel
                (photos, description, price). The same destination as View below, and the same
                destination a customer reaches; what differs is only who is asking, decided
                server-side in lib/studio/viewer.ts. Nothing here grants the edit. */}
            {qr?.dataUrl && qr?.target
              ? (
                <a href={qr.target} target="_blank" rel="noreferrer" title="Open the customer page — you can edit it there" style={{ display: 'block' }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={qr.dataUrl} alt="QR code for the public customer page — opens that page" />
                </a>
              )
              : qr?.dataUrl
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={qr.dataUrl} alt="QR code for the public customer page" />
                : <i><QrCode /></i>}
            <span>Opens the customer page — edit its photos, description and price there.</span>
            <span className="v2-bar">
              <button onClick={downloadQr} className="v2-act tap-target"><Download className="w-3.5 h-3.5" /> Download</button>
              {qr?.target && <a href={qr.target} target="_blank" rel="noreferrer" className="v2-act tap-target"><ExternalLink className="w-3.5 h-3.5" /> View &amp; edit</a>}
              {/* The showroom tag. Deliberately the CUSTOMER code — /studio/<id>/print prints
                  publicProductUrl(), never the staff QR sitting at the top of this same page. */}
              {product && <a href={`/studio/${product.id}/print`} target="_blank" rel="noreferrer" className="v2-act tap-target"><Printer className="w-3.5 h-3.5" /> Print customer QR</a>}
            </span>
          </div>
        </div>
      </section>

      {docType && <DocumentCreator product={product} variants={variants} type={docType} onClose={() => { setDocType(null); reloadDocs() }} />}
    </div>
  )
}
