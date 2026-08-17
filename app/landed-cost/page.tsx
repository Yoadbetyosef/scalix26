'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Upload, FileText, AlertTriangle, ChevronRight, Ship } from 'lucide-react'
import { readJson } from '@/lib/http/read-response'
import { INVOICE_ACCEPT_ATTR, invoiceFileError, type DuplicateWarning, type Shipment, type SupplierInvoice } from '@/lib/invoices/types'

// Shipments: a supplier invoice, read, with its freight spread across the products it carried.

type Row = Shipment & { invoice: SupplierInvoice | null }

const STATUS: Record<Shipment['status'], { label: string; tone: string }> = {
  draft: { label: 'Draft', tone: 'bg-sunken text-subtle' },
  extracting: { label: 'Reading…', tone: 'bg-violet-50 text-violet-700' },
  review: { label: 'Needs review', tone: 'bg-amber-50 text-amber-700' },
  applied: { label: 'Applied', tone: 'bg-emerald-50 text-emerald-700' },
  failed: { label: 'Failed', tone: 'bg-red-50 text-red-700' },
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
    <div className="mx-auto max-w-5xl px-4 py-8">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold text-ink"><Ship className="h-6 w-6 text-accent" /> Shipments</h1>
          <p className="mt-1 text-sm text-muted">
            Upload a supplier invoice and its freight and duty are spread across the products it carried.
          </p>
        </div>
        <div>
          <input ref={fileRef} type="file" accept={INVOICE_ACCEPT_ATTR} className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = '' }} />
          <button type="button" onClick={() => fileRef.current?.click()} disabled={busy}
            className="flex h-10 items-center gap-2 rounded-lg bg-ink px-4 text-sm font-semibold text-white disabled:opacity-50">
            <Upload className="h-4 w-4" />
            {busy ? 'Reading the invoice…' : 'Upload invoice'}
          </button>
        </div>
      </header>

      {err && <p className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{err}</p>}

      {dupe && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
          <p className="flex items-center gap-2 text-sm font-medium text-amber-900">
            <AlertTriangle className="h-4 w-4" />
            {dupe.reason === 'same_file'
              ? 'You have uploaded this exact file before.'
              : `You already have invoice ${dupe.invoiceNumber} from ${dupe.supplierName}.`}
          </p>
          <p className="mt-1 text-sm text-amber-800">
            {dupe.appliedAt
              ? `That one was applied on ${new Date(dupe.appliedAt).toLocaleDateString()}. Applying this one as well would add its freight to the same products a second time.`
              : 'That one has not been applied yet.'}
          </p>
          <div className="mt-2 flex gap-4 text-sm">
            <Link href={`/landed-cost/${dupe.shipmentId}`} className="font-medium text-amber-900 underline">See the earlier one</Link>
            <button type="button" onClick={() => setDupe(null)} className="font-medium text-amber-900 underline">
              Keep both
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-hairline-strong px-6 py-12 text-center">
          <FileText className="mx-auto h-8 w-8 text-muted" />
          <p className="mt-3 font-medium text-ink">No shipments yet</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted">
            Upload a supplier invoice as a PDF or a photo. Nothing is written to your products until you have seen the result and approved it.
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-hairline rounded-xl border border-hairline-strong bg-white">
          {rows.map((s) => {
            const status = STATUS[s.status]
            const charges = s.freightTotal + s.dutiesTotal + s.otherTotal
            return (
              <li key={s.id}>
                <Link href={`/landed-cost/${s.id}`} className="flex items-center justify-between gap-4 px-4 py-3 hover:bg-sunken/40">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-ink">{s.reference || s.invoice?.fileName || 'Untitled shipment'}</p>
                    <p className="mt-0.5 truncate text-xs text-muted">
                      {[
                        s.invoice?.invoiceDate && new Date(s.invoice.invoiceDate).toLocaleDateString(),
                        charges > 0 && `${money(charges, s.currency)} freight & duty`,
                        s.invoice?.status === 'failed' && s.invoice.extractionError,
                      ].filter(Boolean).join(' · ')}
                    </p>
                  </div>
                  <span className="flex shrink-0 items-center gap-3">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${status.tone}`}>{status.label}</span>
                    <ChevronRight className="h-4 w-4 text-muted" />
                  </span>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
