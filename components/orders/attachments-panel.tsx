'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Box, FileText, Film, Image as ImageIcon, Upload } from 'lucide-react'
import { ACCEPT_ATTR } from '@/lib/orders/attachment-types'

// Sketches, reference photos, CAD renders, videos and documents for an order. Drag a pile of files in or
// pick them — they upload one after another so a single rejection doesn't lose the rest. The bucket is
// private throughout; previews and links are short-lived signed URLs.

interface Att { id: string; fileName: string; mimeType: string; fileSize: number; visibility: 'internal' | 'public'; url: string | null }

const size = (b: number) => (b >= 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`)
const isImage = (m: string) => m.startsWith('image/') && m !== 'image/heic' && m !== 'image/heif'  // heic won't render in most browsers
const isVideo = (m: string) => m.startsWith('video/')

function KindIcon({ mime }: { mime: string }) {
  const cls = 'h-5 w-5 text-gray-400'
  if (isImage(mime)) return <ImageIcon className={cls} />
  if (isVideo(mime)) return <Film className={cls} />
  if (mime === 'application/pdf') return <FileText className={cls} />
  return <Box className={cls} />                                   // CAD / archive / anything else
}

// ── ONE PHOTO GOES ON THE INVOICE ────────────────────────────────────────────────────────────────
//
// Everything public here prints on the ESTIMATE, which is right — an estimate is where a reference
// diagram, a CAD render and three phone photos belong. The invoice is a different document with a
// different reader, and it prints exactly what is chosen here and nothing else.
//
// Only PUBLIC images are offered. An internal file is filtered out of the customer's document one
// layer down (publicDocumentImagesForTenant), so choosing one would store a preference that silently
// did nothing — the worst of the three possible behaviours.
//
// Nothing chosen prints no image. There is no render-vs-final distinction anywhere in the data; it
// lives in the filename and in her head. So the alternative to "none" is not "the right one", it is
// "whichever was uploaded first".
export function AttachmentsPanel({ orderId, invoiceImageId, canSetInvoiceImage = true }: {
  orderId: string
  invoiceImageId?: string | null
  /** False on a cancelled order — there is no document to put a photograph on. Uploading, sharing and
   *  deleting stay available; only the invoice choice closes, and the route refuses it either way. */
  canSetInvoiceImage?: boolean
}) {
  const [chosen, setChosen] = useState<string | null>(invoiceImageId ?? null)
  const [items, setItems] = useState<Att[]>([])
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<string | null>(null)
  const [errs, setErrs] = useState<string[]>([])
  const [dragging, setDragging] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const base = `/api/orders/${orderId}/attachments`

  const load = useCallback(async () => {
    const r = await fetch(base); if (r.ok) setItems((await r.json()).attachments)
  }, [base])

  // Optimistic, then reconciled by the refresh. A failed write puts the old choice back rather than
  // leaving the panel claiming a photo is on an invoice that it is not.
  const chooseForInvoice = async (id: string | null) => {
    const previous = chosen
    setChosen(id)
    const r = await fetch(`/api/orders/${orderId}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ invoiceImageId: id }),
    })
    if (!r.ok) {
      setChosen(previous)
      const j = await r.json().catch(() => ({}))
      setErrs([j.detail || j.error || 'That photo could not be set on the invoice.'])
    }
  }
  useEffect(() => { let active = true; (async () => { const r = await fetch(base); if (active && r.ok) setItems((await r.json()).attachments) })(); return () => { active = false } }, [base])

  // Sequential rather than parallel: a 100 MB video and a stack of photos at once would otherwise
  // compete for the same connection, and per-file errors stay attributable this way.
  const uploadAll = async (files: File[]) => {
    if (!files.length) return
    setBusy(true); setErrs([])
    const failures: string[] = []
    for (let i = 0; i < files.length; i++) {
      setProgress(`Uploading ${i + 1} of ${files.length}: ${files[i].name}`)
      try {
        const fd = new FormData(); fd.append('file', files[i])
        const r = await fetch(base, { method: 'POST', body: fd })
        if (!r.ok) failures.push(`${files[i].name} — ${(await r.json().catch(() => ({}))).error ?? 'upload failed'}`)
      } catch { failures.push(`${files[i].name} — upload failed`) }
    }
    setProgress(null); setErrs(failures); setBusy(false)
    await load()
  }

  const setVisibility = async (id: string, visibility: 'internal' | 'public') => {
    setBusy(true); try { await fetch(`${base}/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ visibility }) }); await load() } finally { setBusy(false) }
  }
  const remove = async (id: string, name: string) => {
    if (!confirm(`Delete ${name}?`)) return
    setBusy(true); try { await fetch(`${base}/${id}`, { method: 'DELETE' }); await load() } finally { setBusy(false) }
  }

  return (
    <div>
      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); void uploadAll(Array.from(e.dataTransfer.files)) }}
        onClick={() => !busy && fileInput.current?.click()}
        className={`mb-3 flex cursor-pointer flex-col items-center gap-1 rounded-xl border-2 border-dashed px-4 py-6 text-center transition-colors ${dragging ? 'border-gray-900 bg-gray-50' : 'border-gray-300 hover:border-gray-400 hover:bg-gray-50'}`}
      >
        <Upload className="h-5 w-5 text-gray-400" />
        <span className="text-sm font-medium text-gray-900">{busy ? progress ?? 'Working…' : 'Drop files here, or click to choose'}</span>
        <span className="text-xs text-gray-500">Photos, sketches, PDFs, videos, CAD (STL, OBJ, 3DM, STEP, ZIP…) — up to 50 MB each</span>
      </div>
      <input
        ref={fileInput} type="file" multiple className="hidden" accept={ACCEPT_ATTR} disabled={busy}
        onChange={(e) => { void uploadAll(Array.from(e.target.files ?? [])); e.target.value = '' }}
      />

      {errs.length > 0 && (
        <ul className="mb-3 space-y-1 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
          {errs.map((m, i) => <li key={i}>{m}</li>)}
        </ul>
      )}

      {/* Said once, above the list, rather than repeated on every row. It is the answer to "why is my
          ring not on the invoice" and it is true before anything has been chosen. */}
      {canSetInvoiceImage && items.some((x) => isImage(x.mimeType) && x.visibility === 'public') && !chosen && (
        <p className="mb-2 text-xs text-gray-500">
          No photo is set for the invoice, so it will print without one. Everything shared here still
          appears on the estimate.
        </p>
      )}

      {items.length === 0 ? (
        <p className="text-sm text-gray-400">No files yet.</p>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2">
          {items.map((x) => (
            <li key={x.id} className="flex items-start gap-3 rounded-lg border border-gray-200 p-2">
              <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-md bg-gray-50">
                {isImage(x.mimeType) && x.url
                  // eslint-disable-next-line @next/next/no-img-element -- signed one-off URL, not a static asset
                  ? <img src={x.url} alt="" className="h-full w-full object-cover" />
                  : <KindIcon mime={x.mimeType} />}
              </div>
              <div className="min-w-0 flex-1">
                {x.url
                  ? <a href={x.url} target="_blank" rel="noreferrer" className="block truncate text-sm font-medium text-blue-600 hover:underline" title={x.fileName}>{x.fileName}</a>
                  : <span className="block truncate text-sm text-gray-700" title={x.fileName}>{x.fileName}</span>}
                <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                  <span className="text-xs text-gray-400">{size(x.fileSize)}</span>
                  <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${x.visibility === 'public' ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-600'}`}>
                    {x.visibility === 'public' ? 'Shared on approval' : 'Internal only'}
                  </span>
                </div>
                {/* The invoice photo. Offered on public images only — see the note above the component. */}
                {isImage(x.mimeType) && x.visibility === 'public' && canSetInvoiceImage && (
                  <div className="mt-1">
                    {chosen === x.id ? (
                      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700">
                        On the invoice
                        <button onClick={() => void chooseForInvoice(null)} disabled={busy} className="font-normal text-gray-500 underline">remove</button>
                      </span>
                    ) : (
                      <button onClick={() => void chooseForInvoice(x.id)} disabled={busy} className="text-xs text-gray-600 underline">
                        Use on the invoice
                      </button>
                    )}
                  </div>
                )}
                <div className="mt-1 flex gap-2">
                  <button onClick={() => setVisibility(x.id, x.visibility === 'public' ? 'internal' : 'public')} disabled={busy} className="text-xs text-gray-600 underline">{x.visibility === 'public' ? 'Make internal' : 'Share on approval'}</button>
                  <button onClick={() => remove(x.id, x.fileName)} disabled={busy} className="text-xs text-red-600 underline">Delete</button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-2 text-[11px] text-gray-400">Files you upload are shared on the approval page by default — click “Make internal” to keep one to yourself. Storage is private throughout; the approval page serves files through a short-lived, token-scoped link.</p>
    </div>
  )
}
