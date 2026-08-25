'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Upload, AlertTriangle, ChevronRight, Ship } from 'lucide-react'
import { readJson } from '@/lib/http/read-response'
import { INVOICE_ACCEPT_ATTR, invoiceFileError, type DuplicateWarning, type Shipment, type SupplierInvoice } from '@/lib/invoices/types'

// Shipments: a supplier invoice, read, with its freight spread across the products it carried.

type Row = Shipment & { invoice: SupplierInvoice | null }

// Five states, and only two of them need a person: one that wants reviewing and one that failed.
// A draft and an applied shipment are both finished business, so they are mute — the same rule the
// catalogue's shelf states follow.
const STATUS: Record<Shipment['status'], { label: string; hue: string }> = {
  draft: { label: 'Draft', hue: 'var(--v2-mute)' },
  extracting: { label: 'Reading…', hue: 'var(--v2-t3)' },
  review: { label: 'Needs review', hue: 'var(--v2-amber)' },
  applied: { label: 'Applied', hue: 'var(--v2-mute)' },
  failed: { label: 'Failed', hue: 'var(--v2-red)' },
}

const money = (n: number, ccy: string) =>
  `${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${ccy}`

export default function LandedCostPage() {
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [dupe, setDupe] = useState<DuplicateWarning | null>(null)
  const [refresh, setRefresh] = useState(0)
  const fileRef = useRef<HTMLInputElement>(null)

  // The effect is the ONLY thing that fetches the list; anything wanting a refresh bumps `refresh`.
  // Written inline rather than as a reload() the effect calls, which is both what the lint rule accepts
  // and the honest shape — there is one loader, not a loader and a caller that look like two.
  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const r = await fetch('/api/invoices/shipments')
        const d = await readJson<{ shipments: Array<Shipment & { invoice: SupplierInvoice | null }> }>(r, 'Could not load your shipments.')
        if (!alive) return
        setRows(d.shipments || [])
      } catch (e) { if (alive) setErr((e as Error).message) } finally { if (alive) setLoading(false) }
    })()
    return () => { alive = false }
  }, [refresh])

  async function upload(file: File) {
    // Checked here first with the same function the server uses, so a HEIC or an oversized file is
    // refused at the file picker rather than after a 20 MB round trip.
    const problem = invoiceFileError(file.name, file.size)
    if (problem) { setErr(problem); return }

    setBusy(true); setErr(null); setDupe(null)
    try {
      const body = new FormData()
      body.append('file', file)
      const r = await fetch('/api/invoices/shipments', { method: 'POST', body })
      // Not r.json(): an oversized file is refused by the edge with plain text, before this route
      // exists as far as the platform is concerned. See lib/http/read-response.ts.
      const d = await readJson<{ shipmentId: string; duplicate: DuplicateWarning | null }>(r, 'Could not read that invoice.')
      // Shown, never used to block: re-uploading after a failed extraction is legitimate, and the
      // owner is the one who knows which of the two they meant.
      if (d.duplicate) setDupe(d.duplicate)
      setRefresh((n) => n + 1)
      // Straight to the new shipment unless there is a duplicate to look at first — that warning is
      // the whole reason not to navigate away from it.
      if (!d.duplicate) window.location.href = `/landed-cost/${d.shipmentId}`
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }

  return (
    <div className="v2 v2-embedded mx-auto max-w-5xl p-4 sm:p-6 max-md:pb-16">
      {/* No page title: the rail says Supplier bills. The micro-label carries the count. */}
      <div className="v2-head">
        <p className="v2-kick" style={{ ['--ghue' as string]: 'var(--v2-t4)' }}>
          <i />Shipments{rows.length ? ` · ${rows.length}` : ''}
        </p>
        <s />
        <input ref={fileRef} type="file" accept={INVOICE_ACCEPT_ATTR} className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = '' }} />
        <button type="button" onClick={() => fileRef.current?.click()} disabled={busy}
          className="v2-act tap-target" data-solid style={{ ['--ghue' as string]: 'var(--v2-t4)' }}>
          <Upload className="w-3.5 h-3.5" /> {busy ? 'Reading the invoice…' : 'Upload invoice'}
        </button>
      </div>
      <p className="v2-hint" style={{ maxWidth: '60ch', marginBottom: 22 }}>
        Upload a supplier invoice and its freight and duty are spread across the products it carried.
      </p>

      {err && (
        <div className="v2-notice" style={{ ['--ghue' as string]: 'var(--v2-red)', marginBottom: 18 }}>
          <span className="v2-chip-sq"><AlertTriangle /></span><p>{err}</p>
        </div>
      )}

      {/* THE DUPLICATE WARNING. Shown, never used to block — re-uploading after a failed extraction
          is legitimate, and the owner is the one who knows which of the two they meant. */}
      {dupe && (
        <div className="v2-notice" style={{ ['--ghue' as string]: 'var(--v2-amber)', alignItems: 'flex-start', marginBottom: 18 }}>
          <span className="v2-chip-sq"><AlertTriangle /></span>
          <p>
            {dupe.reason === 'same_file'
              ? 'You have uploaded this exact file before.'
              : `You already have invoice ${dupe.invoiceNumber} from ${dupe.supplierName}.`}
            <span style={{ display: 'block', marginTop: 4, fontSize: 13, fontWeight: 400, color: 'var(--v2-ink-45)' }}>
              {dupe.appliedAt
                ? `That one was applied on ${new Date(dupe.appliedAt).toLocaleDateString()}. Applying this one as well would add its freight to the same products a second time.`
                : 'That one has not been applied yet.'}
            </span>
            <span className="v2-bar" style={{ marginTop: 12 }}>
              <Link href={`/landed-cost/${dupe.shipmentId}`} className="v2-act tap-target">See the earlier one</Link>
              <button type="button" onClick={() => setDupe(null)} className="v2-act tap-target">Keep both</button>
            </span>
          </p>
        </div>
      )}

      {loading ? (
        <p className="v2-kick">Loading…</p>
      ) : rows.length === 0 ? (
        <div className="v2-card" data-empty>
          <b>No shipments yet</b>
          <span>
            Upload a supplier invoice as a PDF or a photo. Nothing is written to your products until you
            have seen the result and approved it.
          </span>
        </div>
      ) : (
        <div className="v2-list">
          {rows.map((s2) => {
            const status = STATUS[s2.status]
            const charges = s2.freightTotal + s2.dutiesTotal + s2.otherTotal
            return (
              <Link key={s2.id} href={`/landed-cost/${s2.id}`} className="v2-row tap-target" data-click
                    style={{ ['--chan' as string]: status.hue }}>
                <span className="v2-chip-sq" style={{ ['--ghue' as string]: status.hue }}><Ship /></span>
                <div className="v2-m">
                  <p>
                    <span className="truncate">{s2.reference || s2.invoice?.fileName || 'Untitled shipment'}</span>
                    <span className="v2-stat">{status.label}</span>
                  </p>
                  <span>
                    {[
                      s2.invoice?.invoiceDate && new Date(s2.invoice.invoiceDate).toLocaleDateString(),
                      charges > 0 && `${money(charges, s2.currency)} freight & duty`,
                      s2.invoice?.status === 'failed' && s2.invoice.extractionError,
                    ].filter(Boolean).join(' · ')}
                  </span>
                </div>
                <ChevronRight className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--v2-mute)' }} />
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
